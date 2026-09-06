import isWsl from 'is-wsl';
import os from 'os';
import path from 'path';
import * as shell from './shell';
import fs from 'fs';
import yargsParser from 'yargs-parser';

const argv = yargsParser(process.argv.slice(2));

// Cache the Windows home directory when inside WSL
let winDir;

/**
 * Get the Windows home directory when inside WSL
 * @returns {Promise<string>} The Windows home directory
 */
const getWslWinHomeDir = async () => {
  if (winDir) {return winDir;}
  const windowsHomeRaw = await shell.run('cmd.exe /c "<nul set /p=%UserProfile%" 2>/dev/null', true);
  winDir = await shell.run(`wslpath "${windowsHomeRaw}"`, true);
  return winDir;
};

/** The default context directory, when no --context is given. */
const defaultContextDir = (baseDir: string) => {
  const current = path.join(baseDir, 'ronsel');
  const legacy = path.join(baseDir, 'lab34-flows');
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
};

export const contextDir = async (pathParts) => {
  const baseDir = isWsl ? await getWslWinHomeDir() : os.homedir();
  let context = argv.context;

  let finalPathParts: string[] = [];

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
    
    // Use the context as base and add pathParts
    finalPathParts = [context].concat(pathParts || []);
  } else {
    // Use default: home folder + "ronsel" + pathParts. An installation from
    // before the rename keeps its ~/lab34-flows until a ~/ronsel exists.
    finalPathParts = [defaultContextDir(baseDir)].concat(pathParts || []);
  }

  const finalPath = path.join.apply(null, finalPathParts);
  return finalPath;
};

/**
 * The context directory itself: where every flow, application and config file
 * of this run lives.
 * @returns {Promise<string>} Absolute path
 */
export const contextRoot = async () => contextDir([]);

/**
 * Whether the context directory was chosen with --context, rather than being
 * the default one under the home folder. The UI says so, because "which
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
