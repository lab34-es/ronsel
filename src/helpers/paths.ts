import path from 'path';
import fs from 'fs';
import yargsParser from 'yargs-parser';

const argv = yargsParser(process.argv.slice(2));

/**
 * The folder this run works in, when it was not named with `--context`.
 *
 * There is no folder of ours in the home directory any more: without
 * `--context` the context is the directory the command was run from, and the
 * CLI asks before settling on it. It records the answer here so that
 * everything downstream -- the API, the runner, the applications -- resolves
 * against the same place.
 */
let chosenContext: string | null = null;

/**
 * Work in this directory for the rest of the process.
 * @param {string} directory - Absolute path of the context directory
 */
export const useContext = (directory: string) => {
  chosenContext = path.resolve(directory);
};

export const contextDir = async (pathParts?) => {
  let context = argv.context;

  // Check if context argument is defined
  if (context) {
    const isAbsolute = path.isAbsolute(context);

    if (!isAbsolute) {
      // If context is not absolute, resolve it relative to the current working directory
      context = path.resolve(process.cwd(), context);
    }

    // Ensure the context directory exists
    if (!fs.existsSync(context)) {
      console.error(`Context directory does not exist: ${context}`);
      process.exit(1);
    }
  } else {
    // Whatever the CLI settled on, and the working directory for anything
    // that reached here without going through it
    context = chosenContext || process.cwd();
  }

  const finalPath = path.join.apply(null, [context].concat(pathParts || []));
  return finalPath;
};

/**
 * The context directory itself: where every flow, application and config file
 * of this run lives.
 * @returns {Promise<string>} Absolute path
 */
export const contextRoot = async () => contextDir([]);

/**
 * Whether the context directory was named with --context, rather than being
 * the directory the command was run from. The UI says so, because "which
 * folder am I looking at" is a different question in each case.
 * @returns {boolean}
 */
export const hasCustomContext = () => Boolean(argv.context);

export const createFolder = async (folderPath) => {
  // create if not exists
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
};

export const findFiles = (dir, depth = 0, maxDepth = 4, results: string[] = [], formats?) => {
  if (depth > maxDepth) {return results;}

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        findFiles(fullPath, depth + 1, maxDepth, results);
      } else if (item.isFile()) {
        if (!formats) {
          results.push(fullPath);
          return; 
        }

        const fileName = path.basename(item.name);
        const fileFormat = (fileName.split('.').pop()||'').toLowerCase();
        if (formats.includes(fileFormat)) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory "${dir}":`, err.message);
  }

  return results;
};
