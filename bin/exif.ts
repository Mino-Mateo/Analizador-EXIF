// CLI: node bin/exif.ts [--json | --geojson] [--limpiar <carpeta>] foto1.jpg foto2.png ...
// Requiere Node 22.18 o superior (ejecuta TypeScript de forma nativa).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analizar, limpiar, enlaceMapa, type Analisis, type Limpieza } from "../src/exif.ts";

const AYUDA = `Uso: node bin/exif.ts [opciones] archivo...

Lee EXIF de JPEG, PNG y WebP, evalúa el riesgo de privacidad y opcionalmente escribe copias limpias.

Opciones:
  --json               salida JSON (un objeto por archivo)
  --geojson            FeatureCollection con los puntos GPS (para geojson.io o QGIS)
  --limpiar <carpeta>  escribe en <carpeta> una copia de cada archivo sin metadatos
  -h, --help           muestra esta ayuda`;

let opciones;
try {
  opciones = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      geojson: { type: "boolean" },
      limpiar: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  console.error(`error: ${(e as Error).message}\n\n${AYUDA}`);
  process.exit(2);
}
const { values, positionals: archivos } = opciones;
if (values.help || !archivos.length) {
  console.log(AYUDA);
  process.exit(values.help ? 0 : 2);
}

interface Resultado {
  archivo: string;
  analisis?: Analisis;
  limpieza?: { destino: string; quitado: string[]; avisos: string[] };
  error?: string;
}

const resultados: Resultado[] = [];
if (values.limpiar) mkdirSync(values.limpiar, { recursive: true });

for (const archivo of archivos) {
  const r: Resultado = { archivo };
  resultados.push(r);
  try {
    const datos = readFileSync(archivo);
    r.analisis = analizar(datos);
    if (values.limpiar) {
      const destino = join(values.limpiar, basename(archivo));
      if (resolve(destino) === resolve(archivo)) throw new Error("la carpeta de salida no puede ser la del original (se sobrescribiría)");
      const l: Limpieza = limpiar(datos);
      writeFileSync(destino, l.datos);
      r.limpieza = { destino, quitado: l.quitado, avisos: l.avisos };
    }
  } catch (e) {
    r.error = (e as Error).message;
    console.error(`error: ${archivo}: ${r.error}`);
  }
}

const valor = (a: Analisis, nombre: string) => a.campos.find((c) => c.nombre === nombre)?.valor ?? null;

if (values.geojson) {
  const features = resultados
    .filter((r) => r.analisis?.gps)
    .map(({ archivo, analisis: a }) => {
      const g = a!.gps!;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: g.altitud === null ? [g.lon, g.lat] : [g.lon, g.lat, g.altitud] },
        properties: {
          archivo,
          fechaCaptura: valor(a!, "Fecha de captura"),
          fechaHoraGps: g.fechaHora,
          altitud: g.altitud,
          marca: valor(a!, "Marca"),
          modelo: valor(a!, "Modelo"),
        },
      };
    });
  console.log(JSON.stringify({ type: "FeatureCollection", features }, null, 2));
} else if (values.json) {
  // La miniatura se resume en su tamaño: los bytes no sirven en JSON
  const reemplazo = (_: string, v: unknown) => (v instanceof Uint8Array ? { bytes: v.length } : v);
  console.log(JSON.stringify(resultados, reemplazo, 2));
} else {
  for (const r of resultados) {
    if (!r.analisis) continue;
    const a = r.analisis;
    console.log(`\n${r.archivo}  [${a.formato.toUpperCase()}${a.orden ? `, TIFF ${a.orden}` : ""}]`);
    if (!a.campos.length) console.log("  Sin EXIF");
    const ancho = Math.max(0, ...a.campos.map((c) => c.nombre.length));
    let grupo = "";
    for (const c of a.campos) {
      if (c.grupo !== grupo) console.log(`  -- ${(grupo = c.grupo)}`);
      console.log(`  ${c.nombre.padEnd(ancho)}  ${c.valor}`);
    }
    console.log(`  XMP: ${a.xmp ? "sí" : "no"}   IPTC: ${a.iptc ? "sí" : "no"}`);
    if (a.gps) console.log(`  Mapa: ${enlaceMapa(a.gps)}`);
    console.log(`\n  ${a.riesgo.resumen}`);
    for (const h of a.riesgo.hallazgos) console.log(`  [${h.severidad.toUpperCase()}] ${h.campo}: ${h.valor}\n         ${h.motivo}`);
    if (r.limpieza) {
      const q = r.limpieza.quitado;
      console.log(`\n  Copia limpia: ${r.limpieza.destino} (quitado: ${q.length ? q.join(", ") : "nada"})`);
      for (const aviso of r.limpieza.avisos) console.log(`  Aviso: ${aviso}`);
    }
  }
}

process.exitCode = resultados.some((r) => r.error) ? 1 : 0;
