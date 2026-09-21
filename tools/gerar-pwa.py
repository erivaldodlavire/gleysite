#!/usr/bin/env python3
"""
GERAR-PWA.PY — gera os arquivos de PWA (aplicativo instalável) de UM cliente.

Cria, na pasta de saída (raiz do site do cliente):
  manifest.webmanifest          -> site público   (start_url "./")
  manifest-admin.webmanifest    -> painel admin   (start_url "./admin.html")
  assets/icons/icon-192.png, icon-512.png                 (purpose "any")
  assets/icons/icon-maskable-192.png, icon-maskable-512.png  (purpose "maskable")
  assets/icons/apple-touch-icon.png                        (iOS, 180x180)

Por que arquivos estáticos e não um manifest dinâmico (blob:)? Chrome/Android
e iOS só instalam de forma confiável a partir de um manifest servido por URL
real; blob: falha em vários navegadores. O nome/cores/ícone do cliente são
fixados AQUI, uma vez, no provisionamento (ou quando ele trocar a identidade).

Uso (na pasta do site do cliente):
  python tools/gerar-pwa.py --nome "Gleyciane Araújo" --curto "Gleyciane" \
      --cor-tema "#001f3f" --logo assets/logo.png

Requer Pillow:  pip install pillow
"""
import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Falta o Pillow. Instale com:  pip install pillow")


def hex_para_rgb(cor: str):
    cor = cor.lstrip("#")
    if len(cor) == 3:
        cor = "".join(c * 2 for c in cor)
    if len(cor) != 6:
        sys.exit(f"Cor inválida: #{cor} (use #RRGGBB)")
    return tuple(int(cor[i:i + 2], 16) for i in (0, 2, 4))


def montar_icone(logo: Image.Image, lado: int, fundo, fracao: float) -> Image.Image:
    """Quadrado `lado`x`lado` com fundo sólido e o logo centralizado.

    `fracao` = quanto da LARGURA (ou altura, o que for maior) o logo ocupa.
    Ícone "maskable" usa fração menor: o sistema pode recortar as bordas em
    círculo/squircle e o logo precisa ficar dentro da "zona segura" (centro 80%).
    """
    tela = Image.new("RGBA", (lado, lado), fundo + (255,))
    alvo = int(lado * fracao)
    proporcao = min(alvo / logo.width, alvo / logo.height)
    novo = logo.resize((max(1, round(logo.width * proporcao)), max(1, round(logo.height * proporcao))), Image.LANCZOS)
    tela.alpha_composite(novo, ((lado - novo.width) // 2, (lado - novo.height) // 2))
    return tela.convert("RGB")


def main():
    p = argparse.ArgumentParser(description="Gera manifests e ícones de PWA para um cliente.")
    p.add_argument("--nome", required=True, help='Nome completo (ex: "Gleyciane Araújo")')
    p.add_argument("--curto", help="Nome curto sob o ícone (até ~12 letras). Padrão: --nome")
    p.add_argument("--descricao", default="Site profissional", help="Descrição do app")
    p.add_argument("--logo", default="assets/logo.png", help="Logo (PNG com fundo transparente é o ideal)")
    p.add_argument("--cor-tema", default="#001f3f", help="Cor principal (barra do app e fundo do ícone)")
    p.add_argument("--cor-fundo", help="Cor da tela de abertura. Padrão: igual à cor do tema")
    p.add_argument("--saida", default=".", help="Raiz do site do cliente (padrão: pasta atual)")
    a = p.parse_args()

    raiz = Path(a.saida).resolve()
    logo_path = (raiz / a.logo) if not Path(a.logo).is_absolute() else Path(a.logo)
    if not logo_path.exists():
        sys.exit(f"Logo não encontrado: {logo_path}")

    cor_tema = a.cor_tema if a.cor_tema.startswith("#") else "#" + a.cor_tema
    cor_fundo = a.cor_fundo or cor_tema
    rgb = hex_para_rgb(cor_tema)
    curto = a.curto or a.nome

    logo = Image.open(logo_path).convert("RGBA")
    pasta_icones = raiz / "assets" / "icons"
    pasta_icones.mkdir(parents=True, exist_ok=True)

    icones = {
        "icon-192.png": (192, 0.74),
        "icon-512.png": (512, 0.74),
        "icon-maskable-192.png": (192, 0.58),
        "icon-maskable-512.png": (512, 0.58),
        "apple-touch-icon.png": (180, 0.74),
    }
    for nome_arq, (lado, fracao) in icones.items():
        montar_icone(logo, lado, rgb, fracao).save(pasta_icones / nome_arq, optimize=True)

    def icons():
        return [
            {"src": "assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "assets/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "assets/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ]

    base = {
        "lang": "pt-BR",
        "dir": "ltr",
        "display": "standalone",
        "orientation": "any",
        "background_color": cor_fundo,
        "theme_color": cor_tema,
        "icons": icons(),
    }

    # Site público: escopo = site inteiro.
    publico = {"id": "./", "name": a.nome, "short_name": curto[:12], "description": a.descricao,
               "start_url": "./", "scope": "./", **base}
    # Painel: escopo restrito a admin.html, para que links do SITE público nunca
    # abram dentro do app do painel no celular do dono.
    admin = {"id": "./admin.html", "name": f"{a.nome} · Painel", "short_name": "Painel",
             "description": "Painel administrativo do site", "start_url": "./admin.html",
             "scope": "./admin.html", **base}

    for arquivo, dados in (("manifest.webmanifest", publico), ("manifest-admin.webmanifest", admin)):
        (raiz / arquivo).write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"OK: PWA gerado em {raiz}")
    print("  manifest.webmanifest, manifest-admin.webmanifest")
    print("  " + ", ".join(f"assets/icons/{n}" for n in icones))


if __name__ == "__main__":
    main()
