import { Command } from 'commander';
import chalk from 'chalk';
import { prompt } from '../cli-ui/prompts.js';
import { getOpenAIKey, isAIEnabled } from '../config/user-config.js';
import { initOpenAI, enableMockMode } from '../ai/openai-client.js';
import { recommendModules } from '../ai/recommender.js';
import {
  ensureEmbeddings,
  generateModuleEmbeddings,
  updateEmbeddings,
} from '../ai/embeddings-manager.js';
import { runCoreRapidkitStreamed } from '../core-bridge/pythonRapidkitExec.js';
import { resolveProjectCommandCapabilities } from '../utils/project-command-capabilities.js';
import { logger } from '../logger.js';

function normalizeError(error: unknown): { message: string; code?: string } {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: unknown; code?: unknown };
    return {
      message: typeof maybeError.message === 'string' ? maybeError.message : String(error),
      code: typeof maybeError.code === 'string' ? maybeError.code : undefined,
    };
  }
  return { message: String(error) };
}

function writeJsonAndExit(payload: unknown, exitCode = 0): void {
  console.log(JSON.stringify(payload, null, 2));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export function registerAICommands(program: Command): void {
  const ai = program.command('ai').description('AI-powered features');

  // AI Module Recommender
  ai.command('recommend')
    .description('Get AI-powered module recommendations')
    .argument('[query]', 'What do you want to build? (e.g., "user authentication with email")')
    .option('-n, --number <count>', 'Number of recommendations', '5')
    .option('--json', 'Output as JSON')
    .action(async (query, options) => {
      try {
        // Check if AI is enabled
        if (!isAIEnabled()) {
          if (options.json) {
            writeJsonAndExit(
              {
                ok: false,
                error: {
                  code: 'AI_DISABLED',
                  message: 'AI features are disabled',
                  remediation: 'workspai config ai enable',
                },
              },
              1
            );
          }
          console.log(chalk.yellow('\n⚠️  AI features are disabled'));
          console.log(chalk.gray('Enable with: workspai config ai enable\n'));
          process.exit(1);
        }

        // Get API key
        const apiKey = getOpenAIKey();
        if (!apiKey) {
          if (!options.json) {
            console.log(
              chalk.yellow('\n⚠️  OpenAI API key not configured - using MOCK MODE for testing\n')
            );
            console.log(
              chalk.gray('📝 Note: Mock embeddings provide approximate results for testing.')
            );
            console.log(chalk.gray('   For production, configure your OpenAI API key:\n'));
            console.log(
              chalk.white('   1. Get your key from: https://platform.openai.com/api-keys')
            );
            console.log(chalk.white('   2. Configure it: workspai config set-api-key'));
            console.log(chalk.gray('      OR set: export OPENAI_API_KEY="sk-proj-..."\n'));
          }

          // Enable mock mode to continue without API key
          enableMockMode();
        } else {
          // Initialize OpenAI with real API key
          await initOpenAI(apiKey);
        }

        // Get query from user if not provided
        let userQuery = query;
        if (!userQuery) {
          const answers = await prompt([
            {
              type: 'input',
              name: 'query',
              message: '🤖 What do you want to build?',
              validate: (input: string) => {
                if (input.length === 0) {
                  return 'Please enter a description';
                }
                if (input.length < 3) {
                  return 'Please be more specific (at least 3 characters)';
                }
                return true;
              },
            },
          ]);
          userQuery = answers.query;
        }

        if (!options.json) {
          console.log(chalk.blue('\n🤖 Analyzing your request...\n'));
        }

        // Ensure embeddings exist
        const hasEmbeddings = apiKey ? await ensureEmbeddings(!options.json) : true;
        if (!hasEmbeddings) {
          if (options.json) {
            writeJsonAndExit(
              {
                ok: false,
                query: userQuery,
                error: {
                  code: 'EMBEDDINGS_MISSING',
                  message: 'Module embeddings are not available',
                  remediation: 'workspai ai generate-embeddings',
                },
              },
              1
            );
          }
          console.log(chalk.yellow('\n⚠️  Cannot proceed without embeddings\n'));
          process.exit(1);
        }

        // Get recommendations
        const topK = parseInt(options.number, 10);
        const recommendations = await recommendModules(userQuery, topK);

        // Check if no results found
        if (recommendations.length === 0 || recommendations[0].score < 0.3) {
          console.log(chalk.yellow('\n⚠️  No matching modules found in RapidKit Core registry.\n'));
          console.log(chalk.cyan('💡 Options:\n'));
          console.log(chalk.white('1. Create custom module:'));
          console.log(chalk.gray('   npx workspai modules scaffold <name> --category <category>'));
          console.log(
            chalk.gray(
              '   Example: npx workspai modules scaffold blockchain-integration --category integrations\n'
            )
          );
          console.log(chalk.white('2. Search with different keywords'));
          console.log(
            chalk.gray('   Try more general terms (e.g., "storage" instead of "blockchain")\n')
          );
          console.log(chalk.white('3. Request feature:'));
          console.log(chalk.gray('   https://github.com/chistiq/workspai/issues\n'));

          if (recommendations.length > 0) {
            console.log(chalk.yellow('⚠️  Low confidence matches found:\n'));
          } else {
            return;
          }
        }

        // JSON output
        if (options.json) {
          console.log(JSON.stringify({ query: userQuery, recommendations }, null, 2));
          return;
        }

        // Pretty output
        console.log(chalk.green.bold('📦 Recommended Modules:\n'));

        recommendations.forEach((rec, index) => {
          const scorePercent = (rec.score * 100).toFixed(1);
          const stars = rec.score > 0.8 ? ' ⭐' : '';

          console.log(chalk.bold(`${index + 1}. ${rec.module.name}${stars}`));
          console.log(chalk.gray(`   ${rec.module.description}`));
          console.log(chalk.cyan(`   Match: ${scorePercent}%`) + chalk.gray(` - ${rec.reason}`));
          console.log(chalk.yellow(`   Category: ${rec.module.category}`));

          if (rec.module.dependencies.length > 0) {
            console.log(chalk.magenta(`   Requires: ${rec.module.dependencies.join(', ')}`));
          }

          console.log(); // Empty line
        });

        // Show install command
        const topModules = recommendations.slice(0, 3).map((r) => r.module.id);
        console.log(chalk.cyan('💡 Quick install (top 3):'));
        console.log(chalk.white(`   npx workspai add module ${topModules.join(' ')}\n`));

        // Ask if user wants to install
        const { shouldInstall } = await prompt([
          {
            type: 'confirm',
            name: 'shouldInstall',
            message: 'Would you like to install these modules now?',
            default: false,
          },
        ]);

        if (shouldInstall) {
          const { selectedModules } = await prompt([
            {
              type: 'checkbox',
              name: 'selectedModules',
              message: 'Select modules to install:',
              choices: recommendations.map((rec) => ({
                name: `${rec.module.name} - ${rec.module.description}`,
                value: rec.module.id,
                checked: rec.score > 0.7, // Auto-select high confidence
              })),
            },
          ]);

          const modules = selectedModules as string[];
          if (modules.length > 0) {
            console.log(chalk.blue(`\n📦 Installing ${modules.length} modules...\n`));
            console.log(chalk.gray(`Command: npx workspai add module ${modules.join(' ')}`));

            const capabilities = resolveProjectCommandCapabilities(process.cwd());
            const addCapability = capabilities.commandMap.add;
            if (!addCapability || addCapability.status !== 'supported') {
              console.log(
                chalk.red('\n❌ RapidKit Core modules are not available for this project.')
              );
              console.log(
                chalk.gray(
                  `   ${
                    addCapability?.reason ??
                    'Module commands require RapidKit Core module-enabled project metadata.'
                  }\n`
                )
              );
              return;
            }

            const installExitCode = await runCoreRapidkitStreamed(['add', 'module', ...modules], {
              cwd: process.cwd(),
            });

            if (installExitCode === 0) {
              console.log(chalk.green('\n✅ Selected modules installed successfully\n'));
            } else {
              console.log(
                chalk.red(`\n❌ Module installation failed (exit code: ${installExitCode})\n`)
              );
            }
          } else {
            console.log(chalk.gray('\nNo modules selected\n'));
          }
        }
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        logger.error('\n❌ Error:', normalized.message);

        if (normalized.code === 'invalid_api_key') {
          console.log(chalk.yellow('\n💡 Your API key may be invalid or expired'));
          console.log(chalk.cyan('   Update it: workspai config set-api-key\n'));
        } else if (normalized.message.includes('embeddings file not found')) {
          console.log(chalk.yellow('\n💡 Module embeddings not generated yet'));
          console.log(chalk.cyan('   Generate them (one-time):'));
          console.log(chalk.white('   cd packages/cli'));
          console.log(chalk.white('   export OPENAI_API_KEY="sk-proj-..."'));
          console.log(chalk.white('   npx tsx src/ai/generate-embeddings.ts\n'));
        }

        process.exit(1);
      }
    });

  // AI info command
  ai.command('info')
    .description('Show AI features information')
    .action(() => {
      const apiKey = getOpenAIKey();
      const enabled = isAIEnabled();

      console.log(chalk.bold('\n🤖 Workspai AI Features\n'));

      console.log(chalk.cyan('Status:'), enabled ? chalk.green('Enabled') : chalk.red('Disabled'));
      console.log(
        chalk.cyan('API Key:'),
        apiKey ? chalk.green('Configured ✓') : chalk.red('Not configured ✗')
      );

      console.log(chalk.bold('\n📦 Available Features:\n'));
      console.log(
        chalk.white('• Module Recommender') + chalk.gray(' - AI-powered module suggestions')
      );
      console.log(chalk.gray('  Usage: workspai ai recommend "I need authentication"'));

      console.log(chalk.bold('\n💰 Pricing:\n'));
      console.log(chalk.white('• Per query: ~$0.0002') + chalk.gray(' (practically free)'));
      console.log(chalk.white('• 100 queries: ~$0.02') + chalk.gray(' (2 cents)'));
      console.log(chalk.white('• 1000 queries: ~$0.20') + chalk.gray(' (20 cents)'));

      console.log(chalk.bold('\n🚀 Getting Started:\n'));
      if (!apiKey) {
        console.log(chalk.white('1. Get OpenAI API key: https://platform.openai.com/api-keys'));
        console.log(chalk.white('2. Configure: workspai config set-api-key'));
        console.log(chalk.white('3. Try: workspai ai recommend "user authentication"'));
      } else {
        console.log(chalk.green("✓ You're all set!"));
        console.log(chalk.white('  Try: workspai ai recommend "user authentication"'));
      }

      console.log();
    });

  // Generate embeddings command
  ai.command('generate-embeddings')
    .description('Generate AI embeddings for all modules (one-time setup)')
    .option('--force', 'Force regeneration even if embeddings exist')
    .action(async () => {
      try {
        // Get API key
        const apiKey = getOpenAIKey();
        if (!apiKey) {
          console.log(chalk.red('\n❌ OpenAI API key not configured\n'));
          console.log(chalk.cyan('To generate embeddings, you need an OpenAI API key:\n'));
          console.log(chalk.white('1. Get your key from: https://platform.openai.com/api-keys'));
          console.log(chalk.white('2. Configure it: workspai config set-api-key'));
          console.log(chalk.gray('\n   OR set environment variable:'));
          console.log(chalk.white('   export OPENAI_API_KEY="sk-proj-..."\n'));
          process.exit(1);
        }

        // Initialize OpenAI
        initOpenAI(apiKey);

        // Generate embeddings
        const success = await generateModuleEmbeddings(true);

        if (success) {
          console.log(chalk.green('✅ Ready to use AI recommendations!'));
          console.log(chalk.cyan('Try: workspai ai recommend "authentication"\n'));
        }

        process.exit(success ? 0 : 1);
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        logger.error('Failed to generate embeddings:', normalized.message);
        process.exit(1);
      }
    });

  // Update embeddings command
  ai.command('update-embeddings')
    .description('Update existing embeddings with latest modules')
    .action(async () => {
      try {
        // Get API key
        const apiKey = getOpenAIKey();
        if (!apiKey) {
          console.log(chalk.red('\n❌ OpenAI API key not configured\n'));
          console.log(chalk.white('Set your API key: workspai config set-api-key\n'));
          process.exit(1);
        }

        // Initialize OpenAI
        initOpenAI(apiKey);

        // Update embeddings
        const success = await updateEmbeddings();
        process.exit(success ? 0 : 1);
      } catch (error: unknown) {
        const normalized = normalizeError(error);
        logger.error('Failed to update embeddings:', normalized.message);
        process.exit(1);
      }
    });
}
