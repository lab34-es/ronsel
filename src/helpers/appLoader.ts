/**
 * Loading of user-authored application code.
 *
 * Applications live in the context directory (`<context>/applications/<name>`),
 * outside this package and outside any `node_modules` folder belonging to it.
 * Three things have to be arranged before their code can be required:
 *
 *  - **TypeScript.** Applications are written in TypeScript and Node cannot
 *    require a `.ts` file. Every `.ts` file loaded from here is transpiled in
 *    memory: types are stripped and CommonJS is emitted. It is deliberately a
 *    transpile and not a compile -- there is no type checking at run time, so
 *    a flow never fails to start over a type error, exactly as it never failed
 *    over one when applications were JavaScript. Types are for the editor;
 *    `tsconfig.json` in the context directory (see helpers/bootstrap) is what
 *    makes them work there.
 *
 *  - **`ronsel` itself.** An application imports the package that runs
 *    it. Node would look for it in the `node_modules` folders above the
 *    *context* directory, where nothing is installed, so the import fails for
 *    every user of the published CLI. The package name and the names it
 *    was published under before (`@lab34/flows`, `lab34-flows`) are all
 *    answered with this process's own exports, which also
 *    guarantees an application shares its module instances -- the applications
 *    registry, the mimic servers -- instead of driving a second, independent
 *    copy of them.
 *
 *  - **Loading the file at all.** Application code is loaded through Node's
 *    module system directly rather than through whatever `require` happens to
 *    be in scope. Under a test runner that one is the runner's, which would
 *    apply the runner's own transforms and resolution to code that is not part
 *    of this project. Going straight to Node keeps an application loaded the
 *    same way wherever the tool runs.
 */
import Module from 'module';
import fs from 'fs';
import path from 'path';

import type ts from 'typescript';

/** Node's module system, whose internals this file has to reach into. */
const loader = Module as unknown as {
  _cache: Record<string, NodeModule>;
  _extensions: Record<string, (module: NodeModule, filename: string) => void>;
  _nodeModulePaths: (from: string) => string[];
  prototype: { require: (this: NodeModule, request: string) => unknown };
  new (id: string, parent: NodeModule | null): NodeModule;
};

/** Root of the running installation, i.e. the folder holding package.json. */
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/** What an application may import to reach this package. */
const PACKAGE_NAMES = ['ronsel', '@lab34/flows', 'lab34-flows'];

/**
 * Extensions an application source file may use, in the order they are looked
 * up: TypeScript first, so an application being migrated can keep its old
 * `index.js` around without it shadowing the new `index.ts`.
 */
const SOURCE_EXTENSIONS = ['.ts', '.js'];

/**
 * Resolve one of an application's source files -- its entry point, its mimic
 * -- accepting either extension.
 * @param {string} directory - The application folder
 * @param {string} basename - File name without extension, e.g. "index"
 * @returns {string|null} Absolute path, or null when the file does not exist
 */
export const resolveSourceFile = (directory: string, basename: string): string | null => {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path.join(directory, `${basename}${extension}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

/** The entry point of an application folder. */
export const resolveEntry = (applicationPath: string): string | null => {
  return resolveSourceFile(applicationPath, 'index');
};

let packageExports: unknown;

/**
 * This package, as an application sees it. Resolved on first use rather than
 * at import time: `../index` pulls in the helpers, one of which is this file.
 */
const flows = () => {
  if (!packageExports) {
    packageExports = require('../index');
  }

  return packageExports;
};

/**
 * What an import of this package should become: the exports already running,
 * or -- for a subpath such as `ronsel/helpers/httpClient` -- a path
 * inside the installation, to be loaded normally.
 * @param {string} request
 * @returns {{value: unknown}|{request: string}|null} null to leave it alone
 */
const interceptorFor = (request: string) => {
  for (const name of PACKAGE_NAMES) {
    if (request === name) {
      return { value: flows() };
    }

    if (request.startsWith(`${name}/`)) {
      return { request: path.join(PACKAGE_ROOT, request.slice(name.length + 1)) };
    }
  }

  return null;
};

let interceptorInstalled = false;

/**
 * Answer an application's import of this package, at whatever depth it is
 * made -- the entry point, or a file it requires in turn.
 *
 * `Module.prototype.require` is the one place every `require()` of a
 * Node-loaded module goes through, which is what makes the depth irrelevant.
 * The cost of the hook is two string comparisons, paid by every require in
 * the process.
 */
const installPackageInterceptor = () => {
  if (interceptorInstalled) { return; }
  interceptorInstalled = true;

  const required = loader.prototype.require;

  loader.prototype.require = function (this: NodeModule, request: string) {
    const intercepted = interceptorFor(request);

    if (intercepted && 'value' in intercepted) {
      return intercepted.value;
    }

    return required.call(this, intercepted ? intercepted.request : request);
  };
};

let compilerOptions: ts.CompilerOptions | null = null;

/**
 * Transpile options: what an application is allowed to be written in. They
 * mirror the package's own tsconfig so that code moved between the two behaves
 * the same, and emit inline source maps so a stack trace points at the
 * TypeScript the author wrote rather than at the generated JavaScript.
 */
const optionsFor = (compiler: typeof ts): ts.CompilerOptions => {
  if (!compilerOptions) {
    compilerOptions = {
      module: compiler.ModuleKind.CommonJS,
      moduleResolution: compiler.ModuleResolutionKind.Node10,
      target: compiler.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      // transpileModule compiles one file knowing nothing of the others, which
      // is what isolatedModules describes
      isolatedModules: true,
      inlineSourceMap: true,
      inlineSources: true
    };
  }

  return compilerOptions;
};

let typescriptModule: typeof ts | null = null;

/** Load the compiler lazily: only applications written in TypeScript need it. */
const typescript = (): typeof ts => {
  if (!typescriptModule) {
    typescriptModule = require('typescript') as typeof ts;
  }

  return typescriptModule;
};

/**
 * Turn the TypeScript of an application file into the CommonJS Node runs.
 * Only syntax errors are reported: a type error is not a reason to refuse to
 * run a flow.
 * @param {string} source
 * @param {string} filename
 * @returns {string}
 */
export const transpile = (source: string, filename: string): string => {
  const compiler = typescript();

  const { outputText, diagnostics } = compiler.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: optionsFor(compiler)
  });

  const syntaxError = (diagnostics || [])
    .find(diagnostic => diagnostic.category === compiler.DiagnosticCategory.Error);

  if (syntaxError) {
    const message = compiler.flattenDiagnosticMessageText(syntaxError.messageText, ' ');
    throw new SyntaxError(`${filename}: ${message}`);
  }

  return outputText;
};

let extensionInstalled = false;

/**
 * Make `.ts` loadable, for an application's entry point and for any file it
 * goes on to require.
 */
const installTypeScriptExtension = () => {
  if (extensionInstalled) { return; }
  extensionInstalled = true;

  // Node itself has no .ts handler, but a host that does (tsx, in development)
  // has already installed its own: leave that one in place.
  if (loader._extensions['.ts']) { return; }

  loader._extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = module as unknown as { _compile: (code: string, file: string) => unknown };
    compiled._compile(transpile(source, filename), filename);
  };
};

/** Install both hooks. Idempotent, so callers need not care who was first. */
export const register = () => {
  installPackageInterceptor();
  installTypeScriptExtension();
};

/**
 * Forget everything cached under a folder, so the next load re-reads it.
 *
 * Application code is editable from the UI (the Source view) and the next run
 * has to pick the change up without restarting the server. Purging the whole
 * folder rather than just the entry point covers the files an application
 * splits itself into.
 * @param {string} directory
 */
export const purge = (directory: string) => {
  const prefix = directory.endsWith(path.sep) ? directory : directory + path.sep;

  Object.keys(loader._cache)
    .filter(key => key === directory || key.startsWith(prefix))
    .forEach(key => delete loader._cache[key]);
};

/**
 * Load an application file, fresh. Returns whatever the file exports.
 * @param {string} filename - Absolute path to an index or mimic file
 */
export const load = (filename: string) => {
  register();
  purge(path.dirname(filename));

  const module = new loader(filename, null);
  module.filename = filename;
  module.paths = loader._nodeModulePaths(path.dirname(filename));

  // In the cache before it runs, so that an application split across files
  // that require each other back does not load twice
  loader._cache[filename] = module;

  try {
    (module as unknown as { load: (file: string) => void }).load(filename);
  }
  catch (ex) {
    delete loader._cache[filename];
    throw ex;
  }

  return module.exports;
};
