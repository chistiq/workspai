#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { moduleEmbeddingText, moduleEmbeddingInputHash } from './module-embedding-input.js';
import { getModuleCatalog } from './module-catalog.js';
import { initOpenAI, generateEmbeddings } from './openai-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate embeddings for all modules in the catalog
 * This is a one-time operation that costs ~$0.50
 */
async function generateModuleEmbeddings(apiKey: string) {
  console.log(chalk.blue.bold('\n🤖 Generating AI embeddings for Workspai modules...\n'));

  // Initialize OpenAI
  await initOpenAI(apiKey);

  // Fetch modules dynamically from Python Core
  console.log(chalk.gray('📡 Fetching modules from RapidKit Python Core...'));
  const MODULE_CATALOG = await getModuleCatalog();

  console.log(chalk.green(`✓ Found ${MODULE_CATALOG.length} modules\n`));

  // Prepare texts for embedding
  // Combine all relevant information for better embeddings
  const texts = MODULE_CATALOG.map(moduleEmbeddingText);

  const spinner = ora(`Generating embeddings for ${MODULE_CATALOG.length} modules...`).start();

  try {
    // Generate embeddings (batch operation)
    const embeddings = await generateEmbeddings(texts);

    spinner.succeed(`Generated embeddings for ${MODULE_CATALOG.length} modules`);

    // Create output structure
    const output = {
      model: 'text-embedding-3-small',
      dimension: embeddings[0].length,
      generated_at: new Date().toISOString(),
      modules: MODULE_CATALOG.map((module, index) => ({
        id: module.id,
        name: module.name,
        embedding: embeddings[index],
        inputHash: moduleEmbeddingInputHash(texts[index]),
      })),
    };

    // Ensure data directory exists
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save to file
    const outputPath = path.join(dataDir, 'modules-embeddings.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

    const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(2);

    console.log(chalk.green(`\n✅ Success!\n`));
    console.log(chalk.white(`📁 Saved to: ${outputPath}`));
    console.log(chalk.white(`💾 File size: ${fileSize} KB`));
    console.log(chalk.white(`📊 Embedding dimension: ${output.dimension}`));
    console.log(chalk.white(`� Model: ${output.model}`));
    console.log(chalk.gray(`\n💰 Cost: ~$0.50 (one-time)\n`));

    console.log(chalk.cyan('🎉 You can now use AI module recommendations!'));
    console.log(chalk.gray('   Try: npx workspai ai recommend "I need user authentication"\n'));
  } catch (error) {
    spinner.fail('Failed to generate embeddings');
    throw error;
  }
}

// Main execution
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error(chalk.red('\n❌ Error: OPENAI_API_KEY environment variable is required\n'));
  console.log(chalk.cyan('Get your API key from: https://platform.openai.com/api-keys'));
  console.log(chalk.gray('\nThen run:'));
  console.log(chalk.white('  export OPENAI_API_KEY="sk-proj-..."'));
  console.log(chalk.white('  npx tsx src/ai/generate-embeddings.ts\n'));
  process.exit(1);
}

generateModuleEmbeddings(apiKey)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.code === 'invalid_api_key') {
      console.log(chalk.yellow('\n💡 Your API key may be invalid or expired'));
      console.log(chalk.cyan('   Get a new key: https://platform.openai.com/api-keys\n'));
    }
    process.exit(1);
  });
