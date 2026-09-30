// Analizador y limpiador de metadatos EXIF para JPEG, PNG y WebP.
// Sin dependencias: el mismo código corre en Node y en el navegador.

export type Formato = "jpeg" | "png" | "webp";
export type Grupo = "IFD0" | "Exif" | "GPS" | "IFD1" | "PNG";
export type Severidad = "alta" | "media" | "baja";
type Valor = string | number[] | Uint8Array;

export interface Campo {
  grupo: Grupo;
  tag: number;
  nombre: string;
  valor: string;
}

export interface Gps {
  lat: number;
  lon: number;
  altitud: number | null;
  fechaHora: string | null;
}

export interface Hallazgo {
  severidad: Severidad;
  campo: string;
  valor: string;
  motivo: string;
}

export interface Riesgo {
  nivel: Severidad | "ninguno";
  hallazgos: Hallazgo[];
  resumen: string;
}

export interface Analisis {
  formato: Formato;
  orden: "little endian" | "big endian" | null;
  campos: Campo[];
  gps: Gps | null;
  orientacion: number | null;
  miniatura: Uint8Array | null;
  xmp: boolean;
  iptc: boolean;
  riesgo: Riesgo;
}

export interface Limpieza {
  datos: Uint8Array;
  quitado: string[];
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Diccionario de etiquetas (IFD0, Exif IFD e IFD1 comparten numeración)

export const ETIQUETAS: Record<number, string> = {
  0x0100: "Ancho",
  0x0101: "Alto",
  0x0103: "Compresión",
  0x010e: "Descripción",
  0x010f: "Marca",
  0x0110: "Modelo",
  0x0112: "Orientación",
  0x011a: "Resolución horizontal",
  0x011b: "Resolución vertical",
  0x0128: "Unidad de resolución",
  0x0131: "Software",
  0x0132: "Fecha de modificación",
  0x013b: "Autor",
  0x013c: "Equipo",
  0x0213: "Posición YCbCr",
  0x8298: "Copyright",
  0x829a: "Exposición",
  0x829d: "Apertura",
  0x8822: "Programa de exposición",
  0x8827: "ISO",
  0x8830: "Tipo de sensibilidad",
  0x9000: "Versión EXIF",
  0x9003: "Fecha de captura",
  0x9004: "Fecha de digitalización",
  0x9010: "Zona horaria (modificación)",
  0x9011: "Zona horaria (captura)",
  0x9012: "Zona horaria (digitalización)",
  0x9201: "Velocidad de obturación (APEX)",
  0x9202: "Apertura (APEX)",
  0x9203: "Brillo (APEX)",
  0x9204: "Compensación de exposición",
  0x9205: "Apertura máxima",
  0x9206: "Distancia al sujeto",
  0x9207: "Modo de medición",
  0x9208: "Fuente de luz",
  0x9209: "Flash",
  0x920a: "Distancia focal",
  0x927c: "Nota del fabricante (MakerNote)",
  0x9286: "Comentario",
  0x9290: "Subsegundos (modificación)",
  0x9291: "Subsegundos (captura)",
  0x9292: "Subsegundos (digitalización)",
  0xa000: "Versión FlashPix",
  0xa001: "Espacio de color",
  0xa002: "Ancho en píxeles",
  0xa003: "Alto en píxeles",
  0xa217: "Método de captura",
  0xa300: "Origen del archivo",
  0xa301: "Tipo de escena",
  0xa401: "Procesado personalizado",
  0xa402: "Modo de exposición",
  0xa403: "Balance de blancos",
  0xa404: "Zoom digital",
  0xa405: "Focal equivalente 35 mm",
  0xa406: "Tipo de toma",
  0xa408: "Contraste",
  0xa409: "Saturación",
  0xa40a: "Nitidez",
  0xa40c: "Rango de distancia",
  0xa420: "ID único de imagen",
  0xa430: "Dueño de la cámara",
  0xa431: "Número de serie de la cámara",
  0xa432: "Especificación de la lente",
  0xa433: "Marca de la lente",
  0xa434: "Lente",
  0xa435: "Número de serie de la lente",
};

export const ETIQUETAS_GPS: Record<number, string> = {
  0x00: "Versión GPS",
  0x02: "Latitud",
  0x04: "Longitud",
  0x06: "Altitud",
  0x07: "Hora GPS (UTC)",
  0x08: "Satélites",
  0x0d: "Velocidad",
  0x0f: "Rumbo",
  0x11: "Dirección de la cámara",
  0x12: "Datum",
  0x1b: "Método de posicionamiento",
  0x1d: "Fecha GPS",
  0x1f: "Error horizontal",
};

// Punteros y referencias que no se muestran como campos propios
const PUNTEROS = new Set([0x8769, 0x8825, 0xa005, 0x0201, 0x0202]);
const REFERENCIAS_GPS = new Set([0x01, 0x03, 0x05, 0x0c, 0x0e, 0x10]);

// ---------------------------------------------------------------------------
// Formato legible

const ORIENTACIONES: Record<number, string> = {
  1: "Normal",
  2: "Espejo horizontal",
  3: "Rotar 180°",
  4: "Espejo vertical",
  5: "Espejo horizontal y rotar 270° en sentido horario",
  6: "Rotar 90° en sentido horario",
  7: "Espejo horizontal y rotar 90° en sentido horario",
  8: "Rotar 270° en sentido horario",
};

const primero = (v: Valor) => (Array.isArray(v) ? v[0] : NaN);
const redondear = (x: number, d = 2) => String(Number(x.toFixed(d)));
const tabla = (m: Record<number, string>) => (v: Valor) => m[primero(v)] ?? String(primero(v));
// Un byte por carácter (TextDecoder("latin1") es en realidad windows-1252 y altera 0x80-0x9F)
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
};
const fecha = (v: Valor) => texto(v).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
const version = (v: Valor) => {
  const s = texto(v);
  return /^\d{4}$/.test(s) ? `${Number(s.slice(0, 2))}.${s.slice(2)}` : s;
};

function texto(v: Valor): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) {
    const s = latin1(v).replace(/\0+$/, "");
    return /^[\x20-\x7e]*$/.test(s) && s.length <= 64 ? s : `(${v.length} bytes)`;
  }
  const partes = v.slice(0, 16).map((x) => redondear(x, 4));
  return partes.join(", ") + (v.length > 16 ? ", ..." : "");
}

// UserComment y GPSProcessingMethod: 8 bytes de juego de caracteres y luego el texto
function comentario(v: Valor, le: boolean): string {
  if (!(v instanceof Uint8Array) || v.length < 8) return texto(v);
  const juego = latin1(v.subarray(0, 8)).replace(/\0+$/, "");
  const cuerpo = v.subarray(8);
  const codificacion = juego === "UNICODE" ? (le ? "utf-16le" : "utf-16be") : "utf-8";
  return new TextDecoder(codificacion).decode(cuerpo).replace(/\0+$/, "").trim();
}

function flash(v: Valor): string {
  const x = primero(v);
  if (x & 0x20) return "Sin flash";
  const partes = [x & 1 ? "Disparado" : "No disparado"];
  const modo = (x >> 3) & 3;
  if (modo) partes.push(["", "modo forzado", "modo apagado", "modo automático"][modo]);
  const retorno = (x >> 1) & 3;
  if (retorno === 2) partes.push("sin luz de retorno");
  if (retorno === 3) partes.push("con luz de retorno");
  if (x & 0x40) partes.push("reducción de ojos rojos");
  return partes.join(", ");
}

function exposicion(v: Valor): string {
  const x = primero(v);
  return x > 0 && x < 1 ? `1/${Math.round(1 / x)} s` : `${redondear(x)} s`;
}

function lente(v: Valor): string {
  if (!Array.isArray(v) || v.length < 4) return texto(v);
  const rango = (a: number, b: number) => (a === b ? redondear(a, 1) : `${redondear(a, 1)}-${redondear(b, 1)}`);
  const f = v[2] ? ` f/${rango(v[2], v[3] || v[2])}` : "";
  return `${rango(v[0], v[1])} mm${f}`;
}

const FORMATOS: Record<number, (v: Valor, le: boolean) => string> = {
  0x0103: tabla({ 1: "Sin compresión", 6: "JPEG" }),
  0x0112: tabla(ORIENTACIONES),
  0x0128: tabla({ 1: "Sin unidad", 2: "Pulgadas", 3: "Centímetros" }),
  0x0132: fecha,
  0x0213: tabla({ 1: "Centrada", 2: "Co-situada" }),
  0x829a: exposicion,
  0x829d: (v) => `f/${redondear(primero(v), 1)}`,
  0x8822: tabla({ 0: "No definido", 1: "Manual", 2: "Normal", 3: "Prioridad de apertura", 4: "Prioridad de obturación", 5: "Creativo", 6: "Acción", 7: "Retrato", 8: "Paisaje" }),
  0x8827: (v) => `ISO ${primero(v)}`,
  0x9000: version,
  0x9003: fecha,
  0x9004: fecha,
  0x9202: (v) => `f/${redondear(Math.SQRT2 ** primero(v), 1)}`,
  0x9204: (v) => `${primero(v) > 0 ? "+" : ""}${redondear(primero(v), 1)} EV`,
  0x9205: (v) => `f/${redondear(Math.SQRT2 ** primero(v), 1)}`,
  0x9206: (v) => `${redondear(primero(v))} m`,
  0x9207: tabla({ 0: "Desconocido", 1: "Promedio", 2: "Promedio ponderado al centro", 3: "Puntual", 4: "Multipunto", 5: "Matricial", 6: "Parcial" }),
  0x9208: tabla({ 0: "Desconocida", 1: "Luz de día", 2: "Fluorescente", 3: "Tungsteno", 4: "Flash", 9: "Buen tiempo", 10: "Nublado", 11: "Sombra" }),
  0x9209: flash,
  0x920a: (v) => `${redondear(primero(v), 1)} mm`,
  0x9286: comentario,
  0xa000: version,
  0xa001: tabla({ 1: "sRGB", 65535: "Sin calibrar" }),
  0xa217: tabla({ 1: "No definido", 2: "Sensor de un chip", 3: "Sensor de dos chips", 4: "Sensor de tres chips", 5: "Secuencial de color", 7: "Trilineal", 8: "Lineal secuencial de color" }),
  0xa402: tabla({ 0: "Automático", 1: "Manual", 2: "Horquillado automático" }),
  0xa403: tabla({ 0: "Automático", 1: "Manual" }),
  0xa404: (v) => `${redondear(primero(v))}x`,
  0xa405: (v) => `${primero(v)} mm`,
  0xa406: tabla({ 0: "Estándar", 1: "Paisaje", 2: "Retrato", 3: "Nocturna" }),
  0xa432: lente,
};

function dms(v: Valor, ref: string): { decimal: number; texto: string } | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [g, m, s] = v;
  const signo = ref === "S" || ref === "W" ? -1 : 1;
  const decimal = Math.round(signo * (g + m / 60 + s / 3600) * 1e6) / 1e6;
  return { decimal, texto: `${g}° ${m}' ${redondear(s)}" ${ref} (${decimal})` };
}

// ---------------------------------------------------------------------------
// TIFF: cabecera, IFD0 -> Exif IFD / GPS IFD, e IFD1 (miniatura)

const TAMANOS: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

export function leerTiff(t: Uint8Array) {
  if (t.length < 8) throw new Error("Bloque TIFF demasiado corto");
  const firma = latin1(t.subarray(0, 2));
  if (firma !== "II" && firma !== "MM") throw new Error("Cabecera TIFF inválida");
  const le = firma === "II";
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  if (u16(2) !== 42) throw new Error("Cabecera TIFF inválida");

  function leerValor(tipo: number, pos: number, cuenta: number): Valor {
    if (tipo === 2) return new TextDecoder().decode(t.subarray(pos, pos + cuenta)).replace(/\0+$/, "").replace(/\0/g, ", ").trim();
    if (tipo === 1 || tipo === 7) return t.subarray(pos, pos + cuenta);
    const lista: number[] = [];
    for (let k = 0; k < cuenta; k++) {
      const o = pos + k * TAMANOS[tipo];
      if (tipo === 3) lista.push(u16(o));
      else if (tipo === 4) lista.push(u32(o));
      else if (tipo === 5) lista.push(u32(o) / (u32(o + 4) || 1));
      else if (tipo === 6) lista.push(v.getInt8(o));
      else if (tipo === 8) lista.push(v.getInt16(o, le));
      else if (tipo === 9) lista.push(v.getInt32(o, le));
      else if (tipo === 10) lista.push(v.getInt32(o, le) / (v.getInt32(o + 4, le) || 1));
      else if (tipo === 11) lista.push(v.getFloat32(o, le));
      else lista.push(v.getFloat64(o, le));
    }
    return lista;
  }

  const visitados = new Set<number>();
  // Devuelve las entradas del IFD y el offset del siguiente IFD (0 si no hay)
  function ifd(off: number): [Map<number, Valor>, number] {
    const tags = new Map<number, Valor>();
    if (off < 8 || off + 2 > t.length || visitados.has(off)) return [tags, 0];
    visitados.add(off);
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tipo = u16(e + 2);
      const cuenta = u32(e + 4);
      if (!TAMANOS[tipo]) continue;
      const total = TAMANOS[tipo] * cuenta;
      const pos = total <= 4 ? e + 8 : u32(e + 8);
      if (pos + total > t.length) continue; // offset fuera del bloque: se ignora la entrada
      tags.set(u16(e), leerValor(tipo, pos, cuenta));
    }
    const sig = off + 2 + n * 12;
    return [tags, sig + 4 <= t.length ? u32(sig) : 0];
  }
  const puntero = (m: Map<number, Valor>, tag: number) => (m.has(tag) ? primero(m.get(tag)!) : 0);

  const [ifd0, sig] = ifd(u32(4));
  const [exif] = ifd(puntero(ifd0, 0x8769));
  const [gpsTags] = ifd(puntero(ifd0, 0x8825));
  const [ifd1] = ifd(sig);

  const campos: Campo[] = [];
  for (const [grupo, tags] of [["IFD0", ifd0], ["Exif", exif], ["IFD1", ifd1]] as const) {
    for (const [tag, valor] of tags) {
      if (PUNTEROS.has(tag)) continue;
      const nombre = ETIQUETAS[tag] ?? `Etiqueta 0x${tag.toString(16).padStart(4, "0")}`;
      campos.push({ grupo, tag, nombre, valor: (FORMATOS[tag] ?? texto)(valor, le) });
    }
  }

  let miniatura: Uint8Array | null = null;
  const inicioMini = puntero(ifd1, 0x0201);
  const largoMini = puntero(ifd1, 0x0202);
  if (inicioMini && largoMini && inicioMini + largoMini <= t.length) {
    miniatura = t.subarray(inicioMini, inicioMini + largoMini);
    campos.push({ grupo: "IFD1", tag: 0x0201, nombre: "Miniatura incrustada", valor: `JPEG de ${largoMini} bytes` });
  }

  // GPS: se combinan valor y referencia (N/S, E/W, sobre/bajo el nivel del mar...)
  const ref = (tag: number) => {
    const r = gpsTags.get(tag);
    return typeof r === "string" ? r.toUpperCase() : "";
  };
  const lat = gpsTags.has(2) ? dms(gpsTags.get(2)!, ref(1) || "N") : null;
  const lon = gpsTags.has(4) ? dms(gpsTags.get(4)!, ref(3) || "E") : null;
  const altRef = gpsTags.get(5);
  const bajoNivel = altRef instanceof Uint8Array && altRef[0] === 1;
  const altitud = gpsTags.has(6) ? Math.round((bajoNivel ? -1 : 1) * primero(gpsTags.get(6)!) * 10) / 10 : null;
  const hora = gpsTags.get(7);
  const horaTexto = Array.isArray(hora) && hora.length === 3
    ? hora.map((x, i) => (i < 2 ? String(Math.trunc(x)) : redondear(x)).padStart(2, "0")).join(":")
    : null;
  const fechaGps = typeof gpsTags.get(0x1d) === "string" ? fecha(gpsTags.get(0x1d)!) : null;

  for (const [tag, valor] of gpsTags) {
    if (REFERENCIAS_GPS.has(tag)) continue;
    let formateado: string;
    if (tag === 0) formateado = valor instanceof Uint8Array ? [...valor].join(".") : texto(valor);
    else if (tag === 2 && lat) formateado = lat.texto;
    else if (tag === 4 && lon) formateado = lon.texto;
    else if (tag === 6 && altitud !== null) formateado = `${Math.abs(altitud)} m ${bajoNivel ? "bajo" : "sobre"} el nivel del mar`;
    else if (tag === 7 && horaTexto) formateado = `${horaTexto} UTC`;
    else if (tag === 0x0d) formateado = `${redondear(primero(valor))} ${({ K: "km/h", M: "mph", N: "nudos" } as Record<string, string>)[ref(0x0c) || "K"] ?? ""}`.trim();
    else if (tag === 0x0f || tag === 0x11) {
      const norte = ref(tag - 1) === "M" ? "norte magnético" : "norte verdadero";
      formateado = `${redondear(primero(valor))}° (${norte})`;
    } else if (tag === 0x1b) formateado = comentario(valor, le);
    else if (tag === 0x1d) formateado = fecha(valor);
    else if (tag === 0x1f) formateado = `${redondear(primero(valor))} m`;
    else formateado = texto(valor);
    const nombre = ETIQUETAS_GPS[tag] ?? `Etiqueta GPS 0x${tag.toString(16).padStart(2, "0")}`;
    campos.push({ grupo: "GPS", tag, nombre, valor: formateado });
  }

  const gps: Gps | null = lat && lon
    ? { lat: lat.decimal, lon: lon.decimal, altitud, fechaHora: fechaGps && horaTexto ? `${fechaGps} ${horaTexto} UTC` : null }
    : null;
  const orientacion = ifd0.has(0x0112) ? primero(ifd0.get(0x0112)!) : null;
  return { orden: le ? ("little endian" as const) : ("big endian" as const), campos, gps, orientacion, miniatura };
}

// ---------------------------------------------------------------------------
// Contenedores

export function detectarFormato(entrada: Uint8Array | ArrayBuffer): Formato | null {
  const b = bytes(entrada);
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (latin1(b.subarray(0, 8)) === "\x89PNG\r\n\x1a\n") return "png";
  if (latin1(b.subarray(0, 4)) === "RIFF" && latin1(b.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

function formato(b: Uint8Array): Formato {
  const f = detectarFormato(b);
  if (f) return f;
  if (latin1(b.subarray(4, 8)) === "ftyp") {
    throw new Error("Formato no soportado: contenedor ISO BMFF (HEIC, AVIF o MP4). Convierte la imagen a JPEG o usa exiftool");
  }
  throw new Error("Formato no soportado: solo JPEG, PNG y WebP");
}

// Vista Uint8Array simple (un Buffer de Node se serializaría distinto en JSON)
const bytes = (e: Uint8Array | ArrayBuffer) => (e instanceof Uint8Array ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength) : new Uint8Array(e));
const empieza = (d: Uint8Array, prefijo: string) => latin1(d.subarray(0, prefijo.length)) === prefijo;
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b: Uint8Array, i: number) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const sinPrefijoExif = (d: Uint8Array) => (empieza(d, "Exif\0\0") ? d.subarray(6) : d);

const XMP_JPEG = ["http://ns.adobe.com/xap/1.0/\0", "http://ns.adobe.com/xmp/extension/\0"];

interface Bloque {
  tipo: string;
  inicio: number;
  fin: number;
  datos: Uint8Array;
}

// JPEG: segmentos desde SOI hasta SOS (inicio de los datos comprimidos)
function segmentosJpeg(b: Uint8Array): { segmentos: Bloque[]; sos: number } {
  const segmentos: Bloque[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error(`JPEG corrupto: se esperaba un marcador en el byte ${i}`);
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // bytes de relleno
    if (m === 0xda) return { segmentos, sos: i };
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // marcadores sin longitud
    const fin = i + 2 + u16be(b, i + 2);
    if (fin > b.length) throw new Error("JPEG truncado");
    segmentos.push({ tipo: m.toString(16), inicio: i, fin, datos: b.subarray(i + 4, fin) });
    i = fin;
  }
  throw new Error("JPEG sin datos de imagen (no se encontró SOS)");
}

// Recorre los escaneos desde SOS hasta EOI. Devuelve el byte siguiente a EOI.
function finJpeg(b: Uint8Array, i: number): number {
  while (i + 1 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xd9) return i + 2;
    if (m === 0xff) { i++; continue; }
    if (i + 3 >= b.length) break;
    i += 2 + u16be(b, i + 2);
    if (m === 0xda) {
      // Datos comprimidos: 0xFF solo aparece como FF00 (relleno) o FFD0-FFD7 (reinicio)
      while (i + 1 < b.length && (b[i] !== 0xff || b[i + 1] === 0 || (b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
    }
  }
  return b.length;
}

function chunksPng(b: Uint8Array): { chunks: Bloque[]; fin: number } {
  const chunks: Bloque[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const n = u32be(b, i);
    const tipo = latin1(b.subarray(i + 4, i + 8));
    const fin = i + 12 + n;
    if (fin > b.length) throw new Error(`PNG truncado en el chunk ${tipo}`);
    chunks.push({ tipo, inicio: i, fin, datos: b.subarray(i + 8, i + 8 + n) });
    i = fin;
    if (tipo === "IEND") break;
  }
  return { chunks, fin: i };
}

function chunksWebp(b: Uint8Array): { chunks: Bloque[]; fin: number } {
  const chunks: Bloque[] = [];
  const fin = Math.min(b.length, 8 + u32le(b, 4));
  let i = 12;
  while (i + 8 <= fin) {
    const tipo = latin1(b.subarray(i, i + 4));
    const n = u32le(b, i + 4);
    if (i + 8 + n > fin) throw new Error(`WebP truncado en el chunk ${tipo}`);
    const siguiente = Math.min(fin, i + 8 + n + (n & 1)); // los chunks se rellenan a tamaño par
    chunks.push({ tipo, inicio: i, fin: siguiente, datos: b.subarray(i + 8, i + 8 + n) });
    i = siguiente;
  }
  return { chunks, fin };
}

// Separa el bloque TIFF (EXIF) y detecta XMP, IPTC y texto PNG
function extraer(b: Uint8Array, f: Formato) {
  let tiff: Uint8Array | null = null;
  let xmp = false;
  let iptc = false;
  const textos: Campo[] = [];
  if (f === "jpeg") {
    for (const s of segmentosJpeg(b).segmentos) {
      if (s.tipo === "e1" && empieza(s.datos, "Exif\0\0")) tiff ??= s.datos.subarray(6);
      else if (s.tipo === "e1" && XMP_JPEG.some((p) => empieza(s.datos, p))) xmp = true;
      else if (s.tipo === "ed" && empieza(s.datos, "Photoshop 3.0\0") && latin1(s.datos).includes("8BIM\x04\x04")) iptc = true;
    }
  } else if (f === "png") {
    for (const c of chunksPng(b).chunks) {
      if (c.tipo === "eXIf") tiff ??= sinPrefijoExif(c.datos);
      if (c.tipo === "tIME" && c.datos.length === 7) {
        const d = c.datos;
        const dos = (i: number) => String(d[i]).padStart(2, "0");
        textos.push({ grupo: "PNG", tag: 0, nombre: "Fecha de modificación (tIME)", valor: `${u16be(d, 0)}-${dos(2)}-${dos(3)} ${dos(4)}:${dos(5)}:${dos(6)} UTC` });
      }
      if (c.tipo !== "tEXt" && c.tipo !== "iTXt" && c.tipo !== "zTXt") continue;
      const corte = c.datos.indexOf(0);
      const clave = latin1(c.datos.subarray(0, corte));
      if (clave === "XML:com.adobe.xmp") { xmp = true; continue; }
      if (/^Raw profile type (iptc|8bim)$/i.test(clave)) iptc = true;
      let valor: string;
      if (c.tipo === "tEXt") valor = latin1(c.datos.subarray(corte + 1));
      else if (c.tipo === "zTXt") valor = `(texto comprimido, ${c.datos.length - corte - 2} bytes)`;
      else {
        // iTXt: clave\0 compresión método idioma\0 clave traducida\0 texto
        const comprimido = c.datos[corte + 1] === 1;
        const idioma = c.datos.indexOf(0, corte + 3);
        const traducida = c.datos.indexOf(0, idioma + 1);
        const cuerpo = c.datos.subarray(traducida + 1);
        valor = comprimido ? `(texto comprimido, ${cuerpo.length} bytes)` : new TextDecoder().decode(cuerpo);
      }
      textos.push({ grupo: "PNG", tag: 0, nombre: `Texto PNG: ${clave}`, valor });
    }
  } else {
    for (const c of chunksWebp(b).chunks) {
      if (c.tipo === "EXIF") tiff ??= sinPrefijoExif(c.datos);
      if (c.tipo === "XMP ") xmp = true;
    }
  }
  return { tiff, xmp, iptc, textos };
}

// ---------------------------------------------------------------------------
// Riesgo de privacidad

const RIESGOS: Record<number, [Severidad, string]> = {
  0x013b: ["alta", "Nombre del autor: identifica a quien tomó o editó la foto."],
  0x8298: ["alta", "Titular de derechos: suele ser el nombre del autor o su empresa."],
  0xa430: ["alta", "Nombre del dueño de la cámara."],
  0xa431: ["alta", "Número de serie de la cámara: vincula todas las fotos tomadas con el mismo equipo, aunque se publiquen en sitios distintos."],
  0xa435: ["alta", "Número de serie de la lente: vincula fotos del mismo equipo."],
  0x010f: ["media", "Marca del dispositivo: ayuda a perfilar al autor y a vincular fotos."],
  0x0110: ["media", "Modelo del dispositivo: ayuda a perfilar al autor y a vincular fotos."],
  0x0131: ["media", "Software o versión del sistema: perfila el equipo y delata ediciones."],
  0x013c: ["media", "Nombre o sistema del equipo donde se procesó la imagen."],
  0x0132: ["media", "Fecha y hora exactas: junto con otras fotos revelan rutinas y horarios."],
  0x9003: ["media", "Fecha y hora exactas de la captura: revelan rutinas y horarios."],
  0x9004: ["media", "Fecha y hora exactas: revelan rutinas y horarios."],
  0x9010: ["media", "Zona horaria: sugiere el país o la región."],
  0x9011: ["media", "Zona horaria de la captura: sugiere el país o la región."],
  0x9012: ["media", "Zona horaria: sugiere el país o la región."],
  0xa420: ["media", "Identificador único: permite rastrear la misma imagen entre sitios."],
  0x010e: ["media", "Texto libre: puede incluir nombres, lugares o notas."],
  0x9286: ["media", "Texto libre: puede incluir nombres, lugares o notas."],
  0x927c: ["media", "Datos propietarios del fabricante: a menudo incluyen número de serie u otros identificadores."],
};

// Parámetros técnicos de la toma: riesgo bajo, se agrupan en un solo hallazgo
const PARAMETROS = new Set([0x829a, 0x829d, 0x8822, 0x8827, 0x9201, 0x9202, 0x9204, 0x9205, 0x9207, 0x9208, 0x9209, 0x920a, 0xa402, 0xa403, 0xa404, 0xa405, 0xa406, 0xa432, 0xa433, 0xa434]);

const ORDEN: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const ADJETIVO: Record<Severidad, string> = { alta: "alto", media: "medio", baja: "bajo" };

export function evaluarRiesgo(a: Pick<Analisis, "campos" | "gps" | "miniatura" | "xmp" | "iptc">): Riesgo {
  const hallazgos: Hallazgo[] = [];
  if (a.gps) {
    hallazgos.push({
      severidad: "alta",
      campo: "Ubicación GPS",
      valor: `${a.gps.lat}, ${a.gps.lon}`,
      motivo: "Coordenadas exactas de donde se tomó la foto: pueden revelar domicilio, trabajo o rutina.",
    });
  }
  const parametros: string[] = [];
  for (const c of a.campos) {
    if (c.grupo === "PNG") {
      const autor = /author|artist|copyright|owner|creator/i.test(c.nombre);
      const motivo = autor ? "Nombre del autor o titular en un texto del PNG."
        : c.nombre.startsWith("Fecha") ? "Fecha y hora exactas de la última modificación."
        : "Texto incrustado en el PNG: puede incluir nombres, lugares o notas.";
      hallazgos.push({ severidad: autor ? "alta" : "media", campo: c.nombre, valor: c.valor, motivo });
    }
    if (c.grupo !== "IFD0" && c.grupo !== "Exif") continue;
    const r = RIESGOS[c.tag];
    if (r) hallazgos.push({ severidad: r[0], campo: c.nombre, valor: c.valor, motivo: r[1] });
    else if (PARAMETROS.has(c.tag)) parametros.push(c.nombre);
  }
  if (a.miniatura) {
    hallazgos.push({ severidad: "media", campo: "Miniatura incrustada", valor: `${a.miniatura.length} bytes`, motivo: "Puede mostrar la imagen antes de recortarla o editarla." });
  }
  if (a.xmp) hallazgos.push({ severidad: "media", campo: "XMP", valor: "presente", motivo: "Bloque XMP: puede incluir autor, historial de edición o ubicación (su contenido no se analiza aquí)." });
  if (a.iptc) hallazgos.push({ severidad: "media", campo: "IPTC", valor: "presente", motivo: "Bloque IPTC: suele incluir autor, créditos, lugar y palabras clave (su contenido no se analiza aquí)." });
  if (parametros.length) {
    hallazgos.push({ severidad: "baja", campo: "Parámetros de cámara", valor: parametros.join(", "), motivo: "Datos técnicos de la toma: poco sensibles solos, pero suman a la huella del equipo." });
  }
  hallazgos.sort((x, y) => ORDEN[x.severidad] - ORDEN[y.severidad]);

  if (!hallazgos.length) return { nivel: "ninguno", hallazgos, resumen: "Sin metadatos sensibles detectados." };
  const nivel = hallazgos[0].severidad;
  const cuenta = (s: Severidad) => hallazgos.filter((h) => h.severidad === s).length;
  const resumen = `Riesgo ${ADJETIVO[nivel]}: ${hallazgos.length} ${hallazgos.length === 1 ? "hallazgo" : "hallazgos"} (${cuenta("alta")} alta, ${cuenta("media")} media, ${cuenta("baja")} baja).`
    + (a.gps ? " La foto revela dónde se tomó." : "");
  return { nivel, hallazgos, resumen };
}

// ---------------------------------------------------------------------------
// API pública

export function analizar(entrada: Uint8Array | ArrayBuffer): Analisis {
  const b = bytes(entrada);
  const f = formato(b);
  const { tiff, xmp, iptc, textos } = extraer(b, f);
  const t = tiff ? leerTiff(tiff) : { orden: null, campos: [], gps: null, orientacion: null, miniatura: null };
  const base = { formato: f, ...t, campos: [...t.campos, ...textos], xmp, iptc };
  return { ...base, riesgo: evaluarRiesgo(base) };
}

export function enlaceMapa(gps: Pick<Gps, "lat" | "lon">): string {
  return `https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=17/${gps.lat}/${gps.lon}`;
}

const unir = (partes: Uint8Array[]) => {
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) {
    salida.set(p, o);
    o += p.length;
  }
  return salida;
};

function nombreSegmento(s: Bloque): string {
  const n = parseInt(s.tipo, 16);
  if (n === 0xfe) return "COM (comentario)";
  if (n === 0xe1 && empieza(s.datos, "Exif\0\0")) return "APP1 Exif";
  if (n === 0xe1 && XMP_JPEG.some((p) => empieza(s.datos, p))) return "APP1 XMP";
  if (n === 0xed) return "APP13 IPTC/Photoshop";
  return `APP${n - 0xe0}`;
}

const QUITAR_PNG = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

// Copia el archivo sin los bloques de metadatos. No recomprime: los datos de imagen quedan idénticos.
export function limpiar(entrada: Uint8Array | ArrayBuffer): Limpieza {
  const b = bytes(entrada);
  const f = formato(b);
  const quitado: string[] = [];
  const avisos: string[] = [];
  let orientacion: number | null = null;
  try {
    orientacion = analizar(b).orientacion;
  } catch {
    // EXIF ilegible: se limpia igual, solo no se puede avisar de la orientación
  }
  if (orientacion && orientacion !== 1) {
    avisos.push(`La foto tenía orientación "${ORIENTACIONES[orientacion] ?? orientacion}" guardada en EXIF. La copia limpia puede verse girada: corrígela con un editor si hace falta.`);
  }
  const resto = (fin: number, que: string) => {
    if (fin < b.length) quitado.push(`${b.length - fin} bytes después del final de la imagen (${que})`);
  };

  let partes: Uint8Array[];
  if (f === "jpeg") {
    const { segmentos, sos } = segmentosJpeg(b);
    partes = [b.subarray(0, 2)];
    for (const s of segmentos) {
      const n = parseInt(s.tipo, 16);
      const metadato = (n >= 0xe0 && n <= 0xef) || n === 0xfe;
      const conservar = n === 0xe0 || n === 0xee || (n === 0xe2 && empieza(s.datos, "ICC_PROFILE\0"));
      if (metadato && !conservar) quitado.push(nombreSegmento(s));
      else partes.push(b.subarray(s.inicio, s.fin));
    }
    const fin = finJpeg(b, sos);
    partes.push(b.subarray(sos, fin));
    resto(fin, "imágenes MPF, video de Motion Photo u otros datos agregados");
  } else if (f === "png") {
    const { chunks, fin } = chunksPng(b);
    partes = [b.subarray(0, 8)];
    for (const c of chunks) {
      if (QUITAR_PNG.has(c.tipo)) quitado.push(`chunk ${c.tipo}`);
      else partes.push(b.subarray(c.inicio, c.fin)); // chunk entero: el CRC sigue siendo válido
    }
    resto(fin, "datos después de IEND");
  } else {
    const { chunks, fin } = chunksWebp(b);
    partes = [b.slice(0, 12)];
    for (const c of chunks) {
      if (c.tipo === "EXIF" || c.tipo === "XMP ") {
        quitado.push(`chunk ${c.tipo.trim()}`);
      } else if (c.tipo === "VP8X") {
        const copia = b.slice(c.inicio, c.fin);
        copia[8] &= ~0x0c; // bits de EXIF (0x08) y XMP (0x04)
        partes.push(copia);
      } else {
        partes.push(b.subarray(c.inicio, c.fin));
      }
    }
    resto(fin, "datos fuera del contenedor RIFF");
    const tam = partes.reduce((n, p) => n + p.length, 0) - 8;
    new DataView(partes[0].buffer).setUint32(4, tam, true);
  }
  return { datos: unir(partes), quitado, avisos };
}
