/**
 * Embeddings Manager
 * Handles automatic generation and management of module embeddings
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { prompt } from '../cli-ui/prompts.js';
import { createUiSpinner } from '../cli-ui/spinner.js';
import { moduleEmbeddingText, moduleEmbeddingInputHash } from './module-embedding-input.js';
import { getModuleCatalog } from './module-catalog.js';
import { generateEmbeddings, isInitialized, isMockMode } from './openai-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EmbeddingsInfo {
  exists: boolean;
  path: string | null;
  moduleCount: number;
  generatedAt: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Get possible paths for embeddings file
 */
function getEmbeddingsPaths(): string[] {
  return [
    path.join(__dirname, '../../data/modules-embeddings.json'),
    path.join(__dirname, '../data/modules-embeddings.json'),
    path.join(process.cwd(), 'data/modules-embeddings.json'),
  ];
}

/**
 * Check if embeddings file exists
 */
export function checkEmbeddings(): EmbeddingsInfo {
  const possiblePaths = getEmbeddingsPaths();

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const modules = Array.isArray(data) ? data : data.modules || [];

        return {
          exists: true,
          path: p,
          moduleCount: modules.length,
          generatedAt: data.generated_at || null,
        };
      } catch (_error) {
        continue;
      }
    }
  }

  return {
    exists: false,
    path: null,
    moduleCount: 0,
    generatedAt: null,
  };
}

/**
 * Generate embeddings for all modules
 */
export async function generateModuleEmbeddings(
  interactive: boolean = true,
  outputPath?: string
): Promise<boolean> {
  try {
    // Check if OpenAI is initialized or mock mode is enabled
    if (!isInitialized() && !isMockMode()) {
      console.log(chalk.red('\n❌ OpenAI not initialized'));
      console.log(chalk.yellow('Please set your API key:'));
      console.log(chalk.white('  workspai config set-api-key'));
      console.log(chalk.gray('  OR set: export OPENAI_API_KEY="sk-..."\n'));
      return false;
    }

    // Fetch modules
    console.log(chalk.blue('\n🤖 Generating AI embeddings for Workspai modules...\n'));
    console.log(chalk.gray('📡 Fetching modules from Workspai...'));

    const modules = await getModuleCatalog();
    console.log(chalk.green(`✓ Found ${modules.length} modules\n`));

    // Estimate cost
    const estimatedCost = ((modules.length * 50) / 1000000) * 0.02; // ~50 tokens per module
    console.log(chalk.cyan(`💰 Estimated cost: ~$${estimatedCost.toFixed(3)}`));
    console.log(chalk.gray(`   (Based on ${modules.length} modules at $0.02/1M tokens)\n`));

    // Confirm if interactive
    if (interactive) {
      const { confirm } = await prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Generate embeddings now?',
          default: true,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('\n⚠️  Embeddings generation cancelled\n'));
        return false;
      }
    }

    // Prepare texts for embedding
    const texts = modules.map(moduleEmbeddingText);

    const spinner = createUiSpinner(`Generating embeddings for ${modules.length} modules...`, {
      component: 'ai',
      phase: 'embeddings.generate',
    });

    try {
      // Generate embeddings (batch operation)
      const embeddings = await generateEmbeddings(texts);
      spinner.succeed(`Generated embeddings for ${modules.length} modules`);

      // Create output structure
      const output = {
        model: isMockMode() ? 'mock' : 'text-embedding-3-small',
        dimension: embeddings[0].length,
        generated_at: new Date().toISOString(),
        modules: modules.map((module, index) => ({
          id: module.id,
          name: module.name,
          embedding: embeddings[index],
          inputHash: moduleEmbeddingInputHash(texts[index]),
        })),
      };

      // Determine output path
      const finalPath = outputPath || path.join(process.cwd(), 'data', 'modules-embeddings.json');

      // Create directory if needed
      const dir = path.dirname(finalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write to file
      fs.writeFileSync(finalPath, JSON.stringify(output, null, 2));

      console.log(chalk.green('\n✅ Embeddings generated successfully!'));
      console.log(chalk.gray(`📁 Saved to: ${finalPath}`));
      console.log(
        chalk.gray(`📊 Size: ${modules.length} modules, ${embeddings[0].length} dimensions\n`)
      );

      return true;
    } catch (error: unknown) {
      spinner.fail('Failed to generate embeddings');

      const message = errorMessage(error);

      if (message.includes('429')) {
        console.log(chalk.red('\n❌ OpenAI API quota exceeded'));
        console.log(
          chalk.yellow('Please check your billing: https://platform.openai.com/account/billing\n')
        );
      } else if (message.includes('401')) {
        console.log(chalk.red('\n❌ Invalid API key'));
        console.log(chalk.yellow('Please set a valid API key:'));
        console.log(chalk.white('  workspai config set-api-key\n'));
      } else {
        console.log(chalk.red(`\n❌ Error: ${message}\n`));
      }

      return false;
    }
  } catch (error: unknown) {
    console.log(chalk.red(`\n❌ Failed to generate embeddings: ${errorMessage(error)}\n`));
    return false;
  }
}

/**
 * Ensure embeddings exist, generate if needed
 */
export async function ensureEmbeddings(interactive: boolean = true): Promise<boolean> {
  const info = checkEmbeddings();

  if (info.exists) {
    return true;
  }

  // Embeddings don't exist
  console.log(chalk.yellow('\n⚠️  Module embeddings not found'));
  console.log(chalk.gray('AI recommendations require embeddings to be generated.\n'));

  if (!interactive) {
    console.log(chalk.red('❌ Cannot generate embeddings in non-interactive mode'));
    console.log(chalk.white('Run: workspai ai generate-embeddings\n'));
    return false;
  }

  const { action } = await prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        {
          name: '🚀 Generate embeddings now (OpenAI key for production, or mock mode for testing)',
          value: 'generate',
        },
        { name: '📝 Show me how to generate them manually', value: 'manual' },
        { name: '❌ Cancel', value: 'cancel' },
      ],
    },
  ]);

  if (action === 'generate') {
    return await generateModuleEmbeddings(true);
  } else if (action === 'manual') {
    console.log(chalk.cyan('\n📝 To generate embeddings manually:\n'));
    console.log(chalk.white('1. Get OpenAI API key from: https://platform.openai.com/api-keys'));
    console.log(chalk.white('2. Set the API key:'));
    console.log(chalk.gray('   workspai config set-api-key'));
    console.log(chalk.gray('   OR: export OPENAI_API_KEY="sk-..."\n'));
    console.log(chalk.white('3. Generate embeddings:'));
    console.log(chalk.gray('   workspai ai generate-embeddings\n'));
    console.log(chalk.cyan('💰 Cost: ~$0.50 one-time\n'));
    return false;
  }

  return false;
}

/**
 * Update existing embeddings
 */
export async function updateEmbeddings(): Promise<boolean> {
  const info = checkEmbeddings();

  if (!info.exists) {
    console.log(chalk.yellow('\n⚠️  No existing embeddings found'));
    console.log(chalk.gray('Use: workspai ai generate-embeddings\n'));
    return false;
  }

  console.log(chalk.blue('\n🔄 Updating embeddings...'));
  console.log(chalk.gray(`Current: ${info.moduleCount} modules`));
  console.log(chalk.gray(`Generated: ${info.generatedAt || 'unknown'}\n`));

  if (!info.path) {
    return false;
  }

  return await generateModuleEmbeddings(true, info.path);
}
