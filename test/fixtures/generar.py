# Genera los archivos sintéticos de los tests. Nada de fotos reales ni datos personales:
# marca "Demo", nombres de ejemplo y GPS en lugares públicos famosos fuera de Ecuador.
# Pillow 10 no escribe sub-IFD (Exif, GPS, IFD1), por eso el bloque TIFF se arma a mano.
# Uso (desde la raíz del repo): python3 test/fixtures/generar.py
import io
import struct
import zlib
from PIL import Image
from PIL.PngImagePlugin import PngInfo

DIR = "test/fixtures/"
BYTE, ASCII, SHORT, LONG, RATIONAL, UNDEFINED, SLONG, SRATIONAL = 1, 2, 3, 4, 5, 7, 9, 10
TAM = {BYTE: 1, ASCII: 1, SHORT: 2, LONG: 4, RATIONAL: 8, UNDEFINED: 1, SLONG: 4, SRATIONAL: 8}


def valor(e, tipo, v):
    if tipo == ASCII:
        return v.encode() + b"\0"
    if tipo in (BYTE, UNDEFINED):
        return bytes(v)
    if tipo in (SHORT, LONG, SLONG):
        f = {SHORT: "H", LONG: "I", SLONG: "i"}[tipo]
        return struct.pack(e + f * len(v), *v)
    f = "II" if tipo == RATIONAL else "ii"
    return b"".join(struct.pack(e + f, *x) for x in v)


def tiff(e, ifd0, exif=(), gps=(), ifd1=(), miniatura=b""):
    """e: '<' little endian o '>' big endian. Cada IFD es una lista de (tag, tipo, valor)."""
    ifd0, exif, gps, ifd1 = list(ifd0), list(exif), list(gps), list(ifd1)
    if exif:
        ifd0.append((0x8769, LONG, [0]))
    if gps:
        ifd0.append((0x8825, LONG, [0]))
    if ifd1:
        ifd1 += [(0x0201, LONG, [0]), (0x0202, LONG, [len(miniatura)])]
    orden = [("ifd0", ifd0), ("exif", exif), ("gps", gps), ("ifd1", ifd1)]
    pos, o = {}, 8
    for nombre, t in orden:
        if t:
            pos[nombre] = o
            o += 2 + 12 * len(t) + 4
    inicio_datos = o

    def fijar(t, tag, v):
        for i, (g, ti, _) in enumerate(t):
            if g == tag:
                t[i] = (g, ti, [v])

    if exif:
        fijar(ifd0, 0x8769, pos["exif"])
    if gps:
        fijar(ifd0, 0x8825, pos["gps"])
    if ifd1:
        fijar(ifd1, 0x0201, inicio_datos)  # la miniatura va primero en la zona de datos

    datos = bytearray(miniatura)
    salida = bytearray((b"II" if e == "<" else b"MM") + struct.pack(e + "HI", 42, 8))
    for nombre, t in orden:
        if not t:
            continue
        salida += struct.pack(e + "H", len(t))
        for tag, tipo, v in sorted(t, key=lambda x: x[0]):
            b = valor(e, tipo, v)
            cuenta = len(b) // TAM[tipo]
            if len(b) <= 4:
                salida += struct.pack(e + "HHI", tag, tipo, cuenta) + b.ljust(4, b"\0")
            else:
                salida += struct.pack(e + "HHII", tag, tipo, cuenta, inicio_datos + len(datos))
                datos += b + (b"\0" if len(b) % 2 else b"")
        salida += struct.pack(e + "I", pos["ifd1"] if nombre == "ifd0" and ifd1 else 0)
    assert len(salida) == inicio_datos
    return bytes(salida + datos)


def dms(x):
    x = abs(x)
    g = int(x)
    m = int((x - g) * 60)
    s = ((x - g) * 60 - m) * 60
    return [(g, 1), (m, 1), (int(round(s * 100)), 100)]


def gps(lat, lon, alt, bajo=False, extra=()):
    return [
        (0x00, BYTE, [2, 3, 0, 0]),
        (0x01, ASCII, "N" if lat >= 0 else "S"), (0x02, RATIONAL, dms(lat)),
        (0x03, ASCII, "E" if lon >= 0 else "W"), (0x04, RATIONAL, dms(lon)),
        (0x05, BYTE, [1 if bajo else 0]), (0x06, RATIONAL, [(int(alt * 10), 10)]),
        *extra,
    ]


def imagen(w, h, semilla):
    im = Image.new("RGB", (w, h))
    px = im.load()
    for x in range(w):
        for y in range(h):
            px[x, y] = ((x * 4 + semilla) % 256, (y * 5) % 256, (x + y + semilla * 3) % 256)
    return im


def seg(marcador, datos):
    return bytes([0xFF, marcador]) + struct.pack(">H", len(datos) + 2) + datos


def jpeg(img, segmentos=(), cola=b"", **kw):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85, **kw)
    base = buf.getvalue()
    corte = 4 + struct.unpack(">H", base[4:6])[0] if base[2:4] == b"\xff\xe0" else 2  # tras APP0 (JFIF)
    return base[:corte] + b"".join(segmentos) + base[corte:] + cola


def chunk_png(tipo, datos):
    return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))


XMP = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autor de ejemplo</dc:creator>'
       b"</rdf:Description></rdf:RDF></x:xmpmeta>")
IPTC = b"\x1c\x02\x50" + struct.pack(">H", 16) + b"Autor de ejemplo"  # 2:80 By-line
APP13 = b"Photoshop 3.0\0" + b"8BIM\x04\x04\0\0" + struct.pack(">I", len(IPTC)) + IPTC

# 1. JPEG little endian, completo. GPS: Torre Eiffel (N, E)
mini = io.BytesIO()
imagen(16, 12, 1).save(mini, "JPEG", quality=60)
t_le = tiff(
    "<",
    ifd0=[
        (0x010F, ASCII, "Demo"), (0x0110, ASCII, "Camara de ejemplo"), (0x0112, SHORT, [6]),
        (0x011A, RATIONAL, [(72, 1)]), (0x011B, RATIONAL, [(72, 1)]), (0x0128, SHORT, [2]),
        (0x0131, ASCII, "Demo EXIF 1.0"), (0x0132, ASCII, "2026:09:29 10:20:00"),
        (0x013B, ASCII, "Autor de ejemplo"), (0x8298, ASCII, "Demo (c) 2026"),
        (0xFDE8, SLONG, [-42]),  # etiqueta privada para probar SLONG
    ],
    exif=[
        (0x829A, RATIONAL, [(1, 125)]), (0x829D, RATIONAL, [(28, 10)]), (0x8822, SHORT, [2]),
        (0x8827, SHORT, [200]), (0x9000, UNDEFINED, b"0232"),
        (0x9003, ASCII, "2026:09:29 10:15:00"), (0x9004, ASCII, "2026:09:29 10:15:00"),
        (0x9011, ASCII, "+02:00"), (0x9204, SRATIONAL, [(-2, 3)]), (0x9207, SHORT, [5]),
        (0x9209, SHORT, [0x19]), (0x920A, RATIONAL, [(42, 10)]),
        (0x9286, UNDEFINED, b"ASCII\0\0\0Comentario de ejemplo"), (0xA405, SHORT, [26]),
        (0xA403, SHORT, [0]), (0xA420, ASCII, "0123456789abcdef0123456789abcdef"),
        (0xA430, ASCII, "Propietario de ejemplo"), (0xA431, ASCII, "DEMO-000123"),
        (0xA432, RATIONAL, [(24, 1), (70, 1), (28, 10), (4, 1)]), (0xA433, ASCII, "Demo"),
        (0xA434, ASCII, "Lente de ejemplo 24-70mm"), (0xA435, ASCII, "LENTE-000456"),
    ],
    gps=gps(48.8584, 2.2945, 35.5, extra=[
        (0x07, RATIONAL, [(8, 1), (15, 1), (0, 1)]), (0x10, ASCII, "T"),
        (0x11, RATIONAL, [(1234, 10)]), (0x1D, ASCII, "2026:09:29"),
    ]),
    ifd1=[(0x0103, SHORT, [6]), (0x011A, RATIONAL, [(72, 1)]), (0x011B, RATIONAL, [(72, 1)]), (0x0128, SHORT, [2])],
    miniatura=mini.getvalue(),
)
# Cola tras EOI: una segunda imagen con su propio EXIF, como las de MPF o Motion Photo
cola = jpeg(imagen(8, 8, 9), [seg(0xE1, b"Exif\0\0" + tiff("<", [(0x010F, ASCII, "Demo")]))])
open(DIR + "jpeg-le.jpg", "wb").write(jpeg(
    imagen(64, 48, 0),
    [seg(0xE1, b"Exif\0\0" + t_le), seg(0xE1, b"http://ns.adobe.com/xap/1.0/\0" + XMP), seg(0xED, APP13),
     seg(0xFE, b"Comentario de ejemplo")],
    cola=cola, icc_profile=b"ICC-DEMO",
))

# 2. JPEG big endian (orden de muchos iPhone), sin miniatura. GPS: Cristo Redentor (S, W)
t_be = tiff(
    ">",
    ifd0=[(0x010F, ASCII, "Demo"), (0x0110, ASCII, "Telefono de ejemplo"), (0x0131, ASCII, "Demo OS 1.0")],
    exif=[
        (0x829A, RATIONAL, [(1, 60)]), (0x829D, RATIONAL, [(18, 10)]), (0x8827, SHORT, [50]),
        (0x9003, ASCII, "2026:09:28 17:40:05"), (0x9209, SHORT, [0x10]), (0x920A, RATIONAL, [(26, 10)]),
    ],
    gps=gps(-22.9519, -43.2105, 700),
)
open(DIR + "jpeg-be.jpg", "wb").write(jpeg(imagen(40, 30, 2), [seg(0xE1, b"Exif\0\0" + t_be)]))

# 3. PNG con eXIf, tEXt, iTXt (XMP) y tIME. GPS: Badwater Basin, bajo el nivel del mar (N, W)
t_png = tiff("<", ifd0=[(0x010F, ASCII, "Demo"), (0x0110, ASCII, "Escaner de ejemplo")],
             gps=gps(36.2297, -116.7669, 86, bajo=True))
info = PngInfo()
info.add_text("Author", "Autor de ejemplo")
info.add_text("Comment", "Comentario de ejemplo")
info.add_itxt("XML:com.adobe.xmp", XMP.decode())
buf = io.BytesIO()
imagen(32, 24, 3).save(buf, "PNG", pnginfo=info, exif=t_png, icc_profile=b"ICC-DEMO", dpi=(72, 72))
png = buf.getvalue()
fin_ihdr = 8 + 25
png = png[:fin_ihdr] + chunk_png(b"tIME", struct.pack(">HBBBBB", 2026, 9, 29, 10, 15, 0)) + png[fin_ihdr:]
open(DIR + "png-exif.png", "wb").write(png)

# 4. WebP con EXIF, XMP e ICC (Pillow escribe los chunks y la cabecera VP8X). GPS: Opera de Sídney (S, E)
t_webp = tiff("<", ifd0=[(0x010F, ASCII, "Demo"), (0x0110, ASCII, "Camara de ejemplo")],
              gps=gps(-33.8568, 151.2153, 5))
imagen(32, 24, 4).save(DIR + "webp-exif.webp", "WEBP", lossless=True, exif=t_webp, xmp=XMP, icc_profile=b"ICC-DEMO")

# 5. JPEG sin EXIF y 6. formato no soportado
imagen(16, 16, 5).save(DIR + "sin-exif.jpg", "JPEG")
imagen(16, 16, 6).save(DIR + "no-soportado.gif", "GIF")
