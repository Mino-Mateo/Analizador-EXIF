import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { crc32 } from "node:zlib";
import { analizar, limpiar, leerTiff, evaluarRiesgo, detectarFormato, enlaceMapa, type Analisis } from "../src/exif.ts";

// Fixtures sintéticos generados por test/fixtures/generar.py (sin fotos ni datos reales)
const ruta = (f: string) => new URL(`fixtures/${f}`, import.meta.url).pathname;
const cargar = (f: string) => new Uint8Array(readFileSync(ruta(f)));
const campo = (a: Analisis, nombre: string) => a.campos.find((c) => c.nombre === nombre)?.valor;
const tmp = mkdtempSync(join(tmpdir(), "exif-test-"));

const PILLOW = spawnSync("python3", ["-c", "import PIL"]).status === 0;
// Abre con Pillow y devuelve tamaño, claves de info y un hash de los píxeles decodificados
function pillow(datos: Uint8Array) {
  const f = join(tmp, `p-${Math.random().toString(36).slice(2)}`);
  writeFileSync(f, datos);
  const py = "import sys,json,hashlib;from PIL import Image;im=Image.open(sys.argv[1]);im.load();"
    + "print(json.dumps({'formato':im.format,'tam':im.size,'info':sorted(k for k in im.info if isinstance(k,str)),'pixeles':hashlib.sha256(im.convert('RGBA').tobytes()).hexdigest()}))";
  const r = spawnSync("python3", ["-c", py, f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { formato: string; tam: number[]; info: string[]; pixeles: string };
}

// ---------------------------------------------------------------------------
// Lectura

test("JPEG little endian: IFD0 con nombres y formato legible", () => {
  const a = analizar(cargar("jpeg-le.jpg"));
  assert.equal(a.formato, "jpeg");
  assert.equal(a.orden, "little endian");
  assert.equal(campo(a, "Marca"), "Demo");
  assert.equal(campo(a, "Modelo"), "Camara de ejemplo");
  assert.equal(campo(a, "Orientación"), "Rotar 90° en sentido horario");
  assert.equal(a.orientacion, 6);
  assert.equal(campo(a, "Unidad de resolución"), "Pulgadas");
  assert.equal(campo(a, "Fecha de modificación"), "2026-09-29 10:20:00");
  assert.equal(campo(a, "Autor"), "Autor de ejemplo");
  assert.equal(campo(a, "Copyright"), "Demo (c) 2026");
  assert.equal(campo(a, "Etiqueta 0xfde8"), "-42", "SLONG con signo");
});

test("JPEG little endian: Exif IFD con exposición, apertura, ISO, flash y lente", () => {
  const a = analizar(cargar("jpeg-le.jpg"));
  const esperado: Record<string, string> = {
    "Exposición": "1/125 s",
    "Apertura": "f/2.8",
    "ISO": "ISO 200",
    "Programa de exposición": "Normal",
    "Distancia focal": "4.2 mm",
    "Focal equivalente 35 mm": "26 mm",
    "Flash": "Disparado, modo automático",
    "Compensación de exposición": "-0.7 EV",
    "Modo de medición": "Matricial",
    "Versión EXIF": "2.32",
    "Fecha de captura": "2026-09-29 10:15:00",
    "Zona horaria (captura)": "+02:00",
    "Comentario": "Comentario de ejemplo",
    "Especificación de la lente": "24-70 mm f/2.8-4",
    "Lente": "Lente de ejemplo 24-70mm",
    "Dueño de la cámara": "Propietario de ejemplo",
    "Número de serie de la cámara": "DEMO-000123",
    "Número de serie de la lente": "LENTE-000456",
    "ID único de imagen": "0123456789abcdef0123456789abcdef",
  };
  for (const [nombre, valor] of Object.entries(esperado)) assert.equal(campo(a, nombre), valor, nombre);
  assert.ok(a.campos.filter((c) => c.grupo === "Exif").length >= 20);
});

test("JPEG little endian: GPS al norte y este con altitud, hora y fecha GPS", () => {
  const a = analizar(cargar("jpeg-le.jpg"));
  assert.deepEqual(a.gps, { lat: 48.8584, lon: 2.2945, altitud: 35.5, fechaHora: "2026-09-29 08:15:00 UTC" });
  assert.equal(campo(a, "Latitud"), `48° 51' 30.24" N (48.8584)`);
  assert.equal(campo(a, "Longitud"), `2° 17' 40.2" E (2.2945)`);
  assert.equal(campo(a, "Altitud"), "35.5 m sobre el nivel del mar");
  assert.equal(campo(a, "Hora GPS (UTC)"), "08:15:00 UTC");
  assert.equal(campo(a, "Dirección de la cámara"), "123.4° (norte verdadero)");
  assert.equal(campo(a, "Versión GPS"), "2.3.0.0");
  assert.equal(enlaceMapa(a.gps!), "https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945#map=17/48.8584/2.2945");
});

test("JPEG little endian: IFD1 con miniatura JPEG", () => {
  const a = analizar(cargar("jpeg-le.jpg"));
  assert.ok(a.miniatura);
  assert.deepEqual([...a.miniatura.subarray(0, 2)], [0xff, 0xd8]);
  assert.equal(campo(a, "Miniatura incrustada"), `JPEG de ${a.miniatura.length} bytes`);
  assert.ok(a.campos.some((c) => c.grupo === "IFD1" && c.nombre === "Compresión" && c.valor === "JPEG"));
});

test("JPEG big endian: GPS al sur y oeste, sin miniatura", () => {
  const a = analizar(cargar("jpeg-be.jpg"));
  assert.equal(a.orden, "big endian");
  assert.equal(campo(a, "Modelo"), "Telefono de ejemplo");
  assert.equal(campo(a, "Exposición"), "1/60 s");
  assert.equal(campo(a, "Flash"), "No disparado, modo apagado");
  assert.deepEqual(a.gps, { lat: -22.9519, lon: -43.2105, altitud: 700, fechaHora: null });
  assert.match(campo(a, "Latitud")!, / S \(-22\.9519\)$/);
  assert.match(campo(a, "Longitud")!, / W \(-43\.2105\)$/);
  assert.equal(a.miniatura, null);
  assert.ok(!a.campos.some((c) => c.grupo === "IFD1"));
});

test("PNG: eXIf con GPS al norte y oeste bajo el nivel del mar, tEXt y tIME", () => {
  const a = analizar(cargar("png-exif.png"));
  assert.equal(a.formato, "png");
  assert.deepEqual(a.gps, { lat: 36.2297, lon: -116.7669, altitud: -86, fechaHora: null });
  assert.equal(campo(a, "Altitud"), "86 m bajo el nivel del mar");
  assert.equal(campo(a, "Texto PNG: Author"), "Autor de ejemplo");
  assert.equal(campo(a, "Texto PNG: Comment"), "Comentario de ejemplo");
  assert.equal(campo(a, "Fecha de modificación (tIME)"), "2026-09-29 10:15:00 UTC");
});

test("WebP: chunk EXIF con GPS al sur y este", () => {
  const a = analizar(cargar("webp-exif.webp"));
  assert.equal(a.formato, "webp");
  assert.equal(campo(a, "Marca"), "Demo");
  assert.deepEqual(a.gps, { lat: -33.8568, lon: 151.2153, altitud: 5, fechaHora: null });
});

test("detecta XMP e IPTC en los tres formatos", () => {
  const le = analizar(cargar("jpeg-le.jpg"));
  assert.equal(le.xmp, true);
  assert.equal(le.iptc, true);
  const be = analizar(cargar("jpeg-be.jpg"));
  assert.equal(be.xmp, false);
  assert.equal(be.iptc, false);
  assert.equal(analizar(cargar("png-exif.png")).xmp, true, "iTXt XML:com.adobe.xmp");
  assert.equal(analizar(cargar("webp-exif.webp")).xmp, true, "chunk XMP");
});

test("JPEG sin EXIF devuelve análisis vacío", () => {
  const a = analizar(cargar("sin-exif.jpg"));
  assert.equal(a.orden, null);
  assert.deepEqual(a.campos, []);
  assert.equal(a.gps, null);
  assert.equal(a.riesgo.nivel, "ninguno");
});

test("rechaza formatos no soportados y explica HEIC", () => {
  assert.equal(detectarFormato(cargar("no-soportado.gif")), null);
  assert.throws(() => analizar(cargar("no-soportado.gif")), /Formato no soportado: solo JPEG, PNG y WebP/);
  const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
  assert.throws(() => analizar(heic), /HEIC/);
  assert.throws(() => limpiar(heic), /HEIC/);
});

test("JPEG truncado da error claro", () => {
  const b = cargar("jpeg-le.jpg").slice(0, 60);
  assert.throws(() => analizar(b), /JPEG truncado/);
});

test("TIFF: offsets fuera de rango se ignoran y los ciclos de IFD no se cuelgan", () => {
  // IFD0 con una etiqueta ASCII que apunta fuera del bloque, y "siguiente IFD" apuntando a sí mismo
  const t = new Uint8Array(26);
  const v = new DataView(t.buffer);
  t.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x010f, true);
  v.setUint16(12, 2, true);
  v.setUint32(14, 100, true);
  v.setUint32(18, 9999, true);
  v.setUint32(22, 8, true);
  const r = leerTiff(t);
  assert.deepEqual(r.campos, []);
  assert.throws(() => leerTiff(new Uint8Array([0x41, 0x41, 42, 0, 8, 0, 0, 0])), /Cabecera TIFF inválida/);
});

// ---------------------------------------------------------------------------
// Riesgo de privacidad

test("riesgo alto: GPS, números de serie, autor y dueño", () => {
  const r = analizar(cargar("jpeg-le.jpg")).riesgo;
  assert.equal(r.nivel, "alta");
  const altas = r.hallazgos.filter((h) => h.severidad === "alta").map((h) => h.campo);
  assert.deepEqual(altas.sort(), ["Autor", "Copyright", "Dueño de la cámara", "Número de serie de la cámara", "Número de serie de la lente", "Ubicación GPS"]);
  const medias = r.hallazgos.filter((h) => h.severidad === "media").map((h) => h.campo);
  for (const c of ["Fecha de captura", "Modelo", "Software", "ID único de imagen", "Miniatura incrustada", "XMP", "IPTC"]) assert.ok(medias.includes(c), c);
  const baja = r.hallazgos.filter((h) => h.severidad === "baja");
  assert.equal(baja.length, 1);
  assert.match(baja[0].valor, /Exposición, Apertura/);
  assert.equal(r.hallazgos[0].severidad, "alta", "ordenados por severidad");
  assert.match(r.resumen, /^Riesgo alto: 19 hallazgos \(6 alta, 12 media, 1 baja\)\. La foto revela dónde se tomó\.$/);
});

test("riesgo: texto Author de PNG es alto", () => {
  const r = analizar(cargar("png-exif.png")).riesgo;
  assert.ok(r.hallazgos.some((h) => h.campo === "Texto PNG: Author" && h.severidad === "alta"));
  assert.ok(r.hallazgos.some((h) => h.campo === "Texto PNG: Comment" && h.severidad === "media"));
});

test("riesgo bajo si solo hay parámetros de cámara", () => {
  const r = evaluarRiesgo({
    campos: [{ grupo: "Exif", tag: 0x829a, nombre: "Exposición", valor: "1/125 s" }, { grupo: "Exif", tag: 0x8827, nombre: "ISO", valor: "ISO 100" }],
    gps: null, miniatura: null, xmp: false, iptc: false,
  });
  assert.equal(r.nivel, "baja");
  assert.equal(r.resumen, "Riesgo bajo: 1 hallazgo (0 alta, 0 media, 1 baja).");
});

// ---------------------------------------------------------------------------
// Limpieza

// Desde SOS hasta EOI (inclusive): los datos comprimidos de la imagen
function datosJpeg(b: Uint8Array) {
  let i = 2;
  while (b[i + 1] !== 0xda) i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  let fin = i;
  while (!(b[fin] === 0xff && b[fin + 1] === 0xd9)) fin++;
  return b.subarray(i, fin + 2);
}
function marcadores(b: Uint8Array) {
  const lista: number[] = [];
  for (let i = 2; b[i + 1] !== 0xda; i += 2 + ((b[i + 2] << 8) | b[i + 3])) lista.push(b[i + 1]);
  return lista;
}

test("limpiar JPEG: quita APP1 Exif/XMP, APP13, COM y la cola; conserva APP0, ICC y la imagen", () => {
  const original = cargar("jpeg-le.jpg");
  const l = limpiar(original);
  assert.deepEqual(l.quitado.slice(0, 4), ["APP1 Exif", "APP1 XMP", "APP13 IPTC/Photoshop", "COM (comentario)"]);
  assert.match(l.quitado[4], /bytes después del final de la imagen/);
  assert.equal(l.avisos.length, 1);
  assert.match(l.avisos[0], /orientación "Rotar 90° en sentido horario"/);

  const m = marcadores(l.datos);
  assert.ok(!m.includes(0xe1) && !m.includes(0xed) && !m.includes(0xfe));
  assert.equal(m[0], 0xe0, "APP0 JFIF");
  assert.ok(m.includes(0xe2), "APP2 ICC");
  assert.deepEqual(datosJpeg(l.datos), datosJpeg(original), "datos comprimidos idénticos");
  assert.deepEqual([...l.datos.subarray(-2)], [0xff, 0xd9], "termina en EOI");

  const a = analizar(l.datos);
  assert.deepEqual(a.campos, []);
  assert.equal(a.xmp || a.iptc, false);
  assert.equal(a.riesgo.nivel, "ninguno");
});

test("limpiar JPEG: Pillow abre el resultado con los mismos píxeles", { skip: !PILLOW && "Pillow no disponible" }, () => {
  const original = cargar("jpeg-le.jpg");
  const antes = pillow(original);
  const despues = pillow(limpiar(original).datos);
  assert.equal(despues.pixeles, antes.pixeles);
  assert.ok(despues.info.includes("icc_profile"));
  assert.ok(!despues.info.includes("exif") && !despues.info.includes("photoshop") && !despues.info.includes("comment"));
});

test("limpiar JPEG sin metadatos devuelve los mismos bytes", () => {
  const original = cargar("sin-exif.jpg");
  const l = limpiar(original);
  assert.deepEqual(l.datos, original);
  assert.deepEqual(l.quitado, []);
  assert.deepEqual(l.avisos, []);
});

function chunksPng(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lista: Array<{ tipo: string; datos: Uint8Array; crc: number }> = [];
  for (let i = 8; i < b.length;) {
    const n = v.getUint32(i);
    lista.push({ tipo: new TextDecoder().decode(b.subarray(i + 4, i + 8)), datos: b.subarray(i + 8, i + 8 + n), crc: v.getUint32(i + 8 + n) });
    i += 12 + n;
  }
  return lista;
}

test("limpiar PNG: quita eXIf, tEXt, iTXt y tIME; conserva el resto con CRC válidos", () => {
  const original = cargar("png-exif.png");
  const l = limpiar(original);
  assert.deepEqual([...l.quitado].sort(), ["chunk eXIf", "chunk iTXt", "chunk tEXt", "chunk tEXt", "chunk tIME"]);
  const antes = chunksPng(original);
  const despues = chunksPng(l.datos);
  assert.deepEqual(despues.map((c) => c.tipo), antes.filter((c) => !["eXIf", "tEXt", "iTXt", "zTXt", "tIME"].includes(c.tipo)).map((c) => c.tipo));
  assert.ok(despues.some((c) => c.tipo === "iCCP") && despues.some((c) => c.tipo === "pHYs"));
  for (const c of despues) assert.equal(crc32(Buffer.concat([Buffer.from(c.tipo), c.datos])), c.crc, `CRC de ${c.tipo}`);
  const idat = (cs: typeof antes) => Buffer.concat(cs.filter((c) => c.tipo === "IDAT").map((c) => c.datos));
  assert.deepEqual(idat(despues), idat(antes));
  assert.deepEqual(analizar(l.datos).campos, []);
});

test("limpiar PNG: Pillow abre el resultado con los mismos píxeles", { skip: !PILLOW && "Pillow no disponible" }, () => {
  const original = cargar("png-exif.png");
  const antes = pillow(original);
  const despues = pillow(limpiar(original).datos);
  assert.equal(despues.pixeles, antes.pixeles);
  assert.ok(antes.info.includes("Author") && antes.info.includes("exif"));
  assert.ok(!despues.info.includes("Author") && !despues.info.includes("exif") && !despues.info.includes("XML:com.adobe.xmp"));
});

function chunksWebp(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lista: Array<{ tipo: string; datos: Uint8Array }> = [];
  for (let i = 12; i < b.length;) {
    const n = v.getUint32(i + 4, true);
    lista.push({ tipo: new TextDecoder().decode(b.subarray(i, i + 4)), datos: b.subarray(i + 8, i + 8 + n) });
    i += 8 + n + (n & 1);
  }
  return lista;
}

test("limpiar WebP: quita EXIF y XMP, actualiza VP8X y el tamaño RIFF", () => {
  const original = cargar("webp-exif.webp");
  const l = limpiar(original);
  assert.deepEqual(l.quitado.sort(), ["chunk EXIF", "chunk XMP"]);
  const antes = chunksWebp(original);
  const despues = chunksWebp(l.datos);
  assert.equal(antes[0].datos[0], 0x2c, "original: ICC + EXIF + XMP");
  assert.equal(despues[0].tipo, "VP8X");
  assert.equal(despues[0].datos[0], 0x20, "solo queda ICC");
  assert.deepEqual(despues.map((c) => c.tipo), ["VP8X", "ICCP", "VP8L"]);
  assert.deepEqual(despues[2].datos, antes.find((c) => c.tipo === "VP8L")!.datos, "bitstream idéntico");
  assert.equal(new DataView(l.datos.buffer, l.datos.byteOffset).getUint32(4, true), l.datos.length - 8);
  assert.deepEqual(analizar(l.datos).campos, []);
  assert.equal(analizar(l.datos).xmp, false);
});

test("limpiar WebP: Pillow abre el resultado con los mismos píxeles", { skip: !PILLOW && "Pillow no disponible" }, () => {
  const original = cargar("webp-exif.webp");
  const antes = pillow(original);
  const despues = pillow(limpiar(original).datos);
  assert.equal(despues.formato, "WEBP");
  assert.equal(despues.pixeles, antes.pixeles);
  assert.ok(antes.info.includes("exif") && antes.info.includes("xmp"));
  assert.ok(!despues.info.includes("exif") && !despues.info.includes("xmp") && despues.info.includes("icc_profile"));
});

// ---------------------------------------------------------------------------
// CLI

const cli = (...args: string[]) =>
  spawnSync(process.execPath, [new URL("../bin/exif.ts", import.meta.url).pathname, ...args], { encoding: "utf8" });

test("CLI --json: un objeto por archivo con campos y riesgo", () => {
  const r = cli("--json", ruta("jpeg-le.jpg"), ruta("sin-exif.jpg"));
  assert.equal(r.status, 0, r.stderr);
  const salida = JSON.parse(r.stdout);
  assert.equal(salida.length, 2);
  assert.equal(salida[0].analisis.gps.lat, 48.8584);
  assert.equal(salida[0].analisis.riesgo.nivel, "alta");
  assert.ok(salida[0].analisis.miniatura.bytes > 0, "miniatura resumida en bytes");
  assert.equal(salida[1].analisis.riesgo.nivel, "ninguno");
});

test("CLI --geojson: FeatureCollection con los puntos GPS de todas las fotos", () => {
  const r = cli("--geojson", ...["jpeg-le.jpg", "jpeg-be.jpg", "png-exif.png", "webp-exif.webp", "sin-exif.jpg"].map(ruta));
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(r.stdout);
  assert.equal(g.type, "FeatureCollection");
  assert.deepEqual(g.features.map((f: { geometry: { coordinates: number[] } }) => f.geometry.coordinates), [
    [2.2945, 48.8584, 35.5],
    [-43.2105, -22.9519, 700],
    [-116.7669, 36.2297, -86],
    [151.2153, -33.8568, 5],
  ]);
  assert.equal(g.features[0].properties.fechaCaptura, "2026-09-29 10:15:00");
  assert.equal(g.features[0].properties.marca, "Demo");
});

test("CLI: exit code 1 ante un archivo ilegible, sigue con los demás", () => {
  const r = cli("--json", ruta("no-soportado.gif"), ruta("jpeg-be.jpg"), ruta("no-existe.jpg"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no-soportado\.gif: Formato no soportado/);
  assert.match(r.stderr, /no-existe\.jpg/);
  const salida = JSON.parse(r.stdout);
  assert.equal(salida[1].analisis.formato, "jpeg");
  assert.ok(salida[0].error && salida[2].error);
});

test("CLI --limpiar escribe copias sin metadatos y nunca sobrescribe el original", () => {
  const destino = join(tmp, "limpias");
  const r = cli("--limpiar", destino, ruta("jpeg-le.jpg"), ruta("webp-exif.webp"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Copia limpia: .*jpeg-le\.jpg \(quitado: APP1 Exif, APP1 XMP/);
  assert.match(r.stdout, /Aviso: La foto tenía orientación/);
  for (const f of ["jpeg-le.jpg", "webp-exif.webp"]) assert.deepEqual(analizar(readFileSync(join(destino, f))).campos, []);

  const mismo = cli("--limpiar", new URL("fixtures/", import.meta.url).pathname, ruta("jpeg-be.jpg"));
  assert.equal(mismo.status, 1);
  assert.match(mismo.stderr, /no puede ser la del original/);
  assert.ok(existsSync(ruta("jpeg-be.jpg")) && analizar(cargar("jpeg-be.jpg")).gps, "el original sigue intacto");
});
