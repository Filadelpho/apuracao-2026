"""Baixa as fotos oficiais dos candidatos do 2º turno no TSE e tira o fundo branco.

O fundo é removido por preenchimento a partir das bordas: só some o branco
ligado à borda da foto, então camisas e detalhes claros dentro do contorno ficam.

Gera site/public/fotos/<número>.png
Uso: coletor\\.venv\\Scripts\\python.exe coletor\\fotos.py
"""

from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFilter

import tse

DESTINO = Path(__file__).resolve().parent.parent / "site" / "public" / "fotos"

# número do candidato -> sequencial do candidato no TSE (campo sqcand)
CANDIDATOS = {"13": "280002542548", "22": "280002551544"}

TOLERANCIA = 26  # diferença máxima para um pixel contar como fundo


def sem_fundo(foto: Image.Image) -> Image.Image:
    foto = foto.convert("RGB")
    largura, altura = foto.size
    marcada = foto.copy()
    cor_marca = (255, 0, 255)
    # Começa o preenchimento pela borda de cima e pela metade de cima das laterais;
    # embaixo a roupa encosta na borda e uma camisa clara seria apagada junto
    sementes = [(x, 0) for x in range(0, largura, 8)]
    for y in range(0, int(altura * 0.68), 4):
        sementes += [(0, y), (largura - 1, y)]
    for ponto in sementes:
        r, g, b = marcada.getpixel(ponto)
        if min(r, g, b) > 200 and marcada.getpixel(ponto) != cor_marca:
            ImageDraw.floodfill(marcada, ponto, cor_marca, thresh=TOLERANCIA)

    # Máscara: 0 onde virou fundo, 255 no resto
    diferenca = ImageChops.difference(marcada, Image.new("RGB", foto.size, cor_marca)).convert("L")
    mascara = diferenca.point(lambda v: 0 if v < 10 else 255)
    # Abertura (encolhe e expande) apaga pontinhos soltos no fundo; o encolhimento extra
    # tira a franja clara do contorno; o desfoque evita borda serrilhada
    mascara = mascara.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    mascara = mascara.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1))

    resultado = foto.convert("RGBA")
    resultado.putalpha(mascara)
    return resultado


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30) as http:
        for numero, sqcand in CANDIDATOS.items():
            url = f"{tse.BASE}/{tse.CICLO}/{tse.ELEICOES['2t']}/fotos/br/{sqcand}.jpeg"
            resp = http.get(url)
            resp.raise_for_status()
            foto = sem_fundo(Image.open(BytesIO(resp.content)))
            foto.save(DESTINO / f"{numero}.png", optimize=True)
            print(f"{numero}: {foto.size[0]}x{foto.size[1]} salvo")


if __name__ == "__main__":
    main()
