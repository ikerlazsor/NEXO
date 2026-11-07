const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createRequire } = require("node:module");
const {
  classifyExternalEvent,
} = require("../lib/externalEventClassification.cjs");
const {
  normalizeMadridSnapshot,
} = require("../scripts/madrid-events-preview.cjs");

// Use the real taxonomy and bundled-asset declarations without loading a native
// image in Node. Every returned asset ID still maps to an existing local file.
const modules = new Map(),
  assets = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const localRequire = createRequire(filename);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (id) => {
        if (/\.(jpg|png|webp)$/.test(id)) {
          const asset = path.resolve(path.dirname(filename), id);
          assert.ok(fs.existsSync(asset), asset);
          if (!assets.has(asset)) assets.set(asset, assets.size + 1);
          return assets.get(asset);
        }
        if (id.endsWith(".cjs")) return localRequire(id);
        return load(path.resolve(path.dirname(filename), id + ".ts"));
      },
    },
  );
  return exports;
}
const taxonomy = load("lib/categories.ts");
const { eventClassification, eventCoverSource } = load(
  "features/events/covers.ts",
);
const examples = [
  ["Ruta de hiking por la sierra", "AIRE_LIBRE", "senderismo"],
  ["Excursión de senderismo", "AIRE_LIBRE", "senderismo"],
  ["Concierto de jazz", "SHOWTIME", "concierto"],
  ["Teatro para todos", "SHOWTIME", "teatro"],
  ["Proyección de cine", "SHOWTIME", "cine"],
  ["Exposición en el museo", "DESCUBRIR", "museo"],
  ["Club de lectura", "DESCUBRIR", "estudio"],
  ["Taller de inglés", "DESCUBRIR", "idiomas"],
  ["Taller de yoga", "DEPORTES", "otro"],
  ["Torneo de ajedrez", "VIBES", "juegos_mesa"],
  ["Ruta de tapas", "FOODIES", "tapas"],
  ["Evento por confirmar", "DESCUBRIR", "otro"],
];
test("classifies event topics into real Nexo category/subcategory pairs", () => {
  for (const [title, category, subcategory] of examples) {
    const actual = classifyExternalEvent(title);
    assert.equal(actual.category, category, title);
    assert.equal(actual.subcategory, subcategory, title);
    assert.ok(taxonomy.SUBCATEGORIES[category].includes(subcategory));
  }
  assert.equal(
    classifyExternalEvent(
      "Concierto de jazz",
      "Evento",
      "En un museo, con rutas de senderismo cercanas",
    ).subcategory,
    "concierto",
  );
});
test("imported events preserve their subcategory without inventing an event photograph", () => {
  const result = normalizeMadridSnapshot(
    {
      "@graph": [
        {
          id: 123,
          title: "Hiking por la sierra",
          dtstart: "2026-12-12",
          link: "https://www.madrid.es/example",
        },
      ],
    },
    new Date("2026-11-07T10:00:00Z"),
  );
  assert.equal(result.events[0].category, "AIRE_LIBRE");
  assert.equal(result.events[0].subcategory, "senderismo");
  assert.equal("image_url" in result.events[0], false);
});
test("selects the existing local senderismo cover stably and handles older events", () => {
  const event = {
    provider_id: "madrid",
    source_id: "123",
    category: "AIRE_LIBRE",
    title: "Hiking por la sierra",
    description: null,
  };
  assert.equal(eventClassification(event).subcategory, "senderismo");
  const image = eventCoverSource(event);
  assert.ok(
    taxonomy.getCoverImages("AIRE_LIBRE", "senderismo").includes(image),
  );
  assert.equal(eventCoverSource({ ...event }), image);
  assert.ok([...assets.values()].includes(image));
  assert.equal(
    eventClassification({ ...event, subcategory: "invented" }).subcategory,
    "senderismo",
  );
});
test("every classified event uses one of its existing local subcategory covers", () => {
  for (const [title, category, subcategory] of examples) {
    const event = {
      provider_id: "madrid",
      source_id: title,
      title,
      description: null,
      category,
      subcategory,
    };
    const cover = eventCoverSource(event);
    assert.ok(
      taxonomy.getCoverImages(category, subcategory).includes(cover),
      title,
    );
    assert.notEqual(cover, taxonomy.PLACEHOLDER_COVER_URI);
  }
});
