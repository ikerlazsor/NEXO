const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
function createLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  return function load(name) {
    const filename = path.resolve(name);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        exports,
        Date,
        AbortController,
        AbortSignal,
        setTimeout,
        clearTimeout,
        ...globals,
        require: (id) => {
          if (Object.hasOwn(mocks, id)) return mocks[id];
          if (id.endsWith("categories"))
            return {
              normalizeMainCategory: (v) =>
                [
                  "DEPORTES",
                  "VIBES",
                  "AIRE_LIBRE",
                  "FOODIES",
                  "DESCUBRIR",
                  "SHOWTIME",
                ].includes(v)
                  ? v
                  : null,
            };
          if (!id.startsWith(".")) return require(id);
          const target = path.resolve(path.dirname(filename), id);
          return id.endsWith(".cjs")
            ? require(target)
            : load(target + (path.extname(target) ? "" : ".ts"));
        },
      },
      { filename },
    );
    return exports;
  };
}
module.exports = { createLoader };
