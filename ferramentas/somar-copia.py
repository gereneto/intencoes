#!/usr/bin/env python3
"""Soma ao banco o que só um celular tinha (rezas que nunca chegaram ao GitHub).

A cópia de um celular traz, intacto, o estado da versão do GitHub ("legado"):
por intenção, a contagem e a "base" (o que o celular acreditava estar no
GitHub). contagem − base é o que ele rezou e nunca foi enviado: é registro,
não estimativa. Este script mostra essas rezas e, com --aplicar, grava cada
uma como uma linha em `rezas` (origem "recuperada"). Os ids são fixos para
cada celular e intenção: rodar de novo não soma duas vezes.

Uso (da pasta do app):
  python3 ferramentas/somar-copia.py copia.json              só mostra
  python3 ferramentas/somar-copia.py --banco                 lista as cópias no banco
  python3 ferramentas/somar-copia.py --banco 7               mostra a cópia nº 7
  python3 ferramentas/somar-copia.py --banco 7 --aplicar     soma a nº 7 no banco
  python3 ferramentas/somar-copia.py copia.json --aplicar    soma o arquivo no banco

A senha é pedida no terminal (a mesma dos celulares) e não fica guardada.
"""

import getpass
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
NS = uuid.UUID("6f1d2a7e-3c4b-4e8a-9b51-0c2d7e9f4a13")   # fixo: ids reprodutíveis


def config():
    js = (PASTA / "app.js").read_text(encoding="utf-8")
    def pega(nome):
        m = re.search(r'const %s = "([^"]*)"' % nome, js)
        return m.group(1) if m else ""
    url, chave, email = pega("SUPA_URL"), pega("SUPA_CHAVE"), pega("SUPA_EMAIL")
    if not (url and chave and email):
        sys.exit("SUPA_URL / SUPA_CHAVE / SUPA_EMAIL ainda vazios no app.js")
    return url.rstrip("/"), chave, email


class Banco:
    def __init__(self):
        self.url, self.chave, email = config()
        senha = getpass.getpass("Senha do banco das Intenções: ")
        r = self._pedir("POST", "/auth/v1/token?grant_type=password",
                        {"email": email, "password": senha}, auth=False)
        self.token = r["access_token"]

    def _pedir(self, metodo, caminho, corpo=None, auth=True, prefer=None):
        cab = {"apikey": self.chave, "Content-Type": "application/json"}
        if auth:
            cab["Authorization"] = "Bearer " + self.token
        if prefer:
            cab["Prefer"] = prefer
        dados = json.dumps(corpo).encode() if corpo is not None else None
        req = urllib.request.Request(self.url + caminho, data=dados, headers=cab, method=metodo)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                txt = resp.read().decode()
        except urllib.error.HTTPError as e:
            sys.exit("O banco respondeu %s: %s" % (e.code, e.read().decode()[:300]))
        return json.loads(txt) if txt else None

    def ler(self, caminho):
        return self._pedir("GET", "/rest/v1/" + caminho)

    def gravar(self, tabela, linhas, chave, ignorar):
        if not linhas:
            return
        prefer = ("resolution=ignore-duplicates" if ignorar else "resolution=merge-duplicates") + \
                 ",return=minimal"
        self._pedir("POST", "/rest/v1/%s?on_conflict=%s" % (tabela, chave), linhas, prefer=prefer)


def data(ms):
    if not ms:
        return "—"
    return datetime.fromtimestamp(ms / 1000).strftime("%d/%m/%Y %H:%M")


def analisar(copia, banco_itens, banco_textos):
    legado = copia.get("legado") or {}
    itens = legado.get("itens") or []
    aparelho = copia.get("aparelho") or "sem nome"
    marca = hashlib.sha256(json.dumps(legado, sort_keys=True, ensure_ascii=False)
                           .encode()).hexdigest()[:16]

    print("Cópia de “%s”, feita em %s (%s)" % (aparelho, copia.get("em", "?")[:16],
                                              copia.get("motivo", "")))
    sinc = copia.get("legadoSinc") or {}
    print("Última sincronia com o GitHub: %s" % data(sinc.get("em")))
    if not itens:
        print("A cópia não tem dados da versão do GitHub: nada a recuperar.")
        return aparelho, [], [], []

    somar, faltam, estranhos = [], [], []
    for it in itens:
        cont = int(it.get("contagem") or 0)
        base = int(it.get("base") if it.get("base") is not None else cont)
        delta = cont - base
        b = banco_itens.get(it["id"]) if banco_itens is not None else None
        apagada = b is not None and b.get("apagada_em") is not None
        # fora do banco: se nunca chegou ao GitHub (base 0), nasceu neste
        # celular e entra; se chegou, foi apagada no outro e não volta sozinha
        ausente = banco_itens is not None and b is None
        nova = ausente and base == 0
        if delta < 0:
            estranhos.append((it, cont, base, "contagem menor que a base"))
        elif apagada:
            if delta > 0:
                estranhos.append((it, cont, base, "apagada no banco"))
        elif ausente and not nova:
            estranhos.append((it, cont, base, "não está no banco (apagada no outro celular?)"))
        else:
            if nova:
                faltam.append(it)
            if delta > 0:
                somar.append((it, delta))

    total = sum(d for _, d in somar)
    print("\nRezas deste celular que nunca chegaram ao GitHub: %d, em %d intenções"
          % (total, len(somar)))
    for it, d in sorted(somar, key=lambda x: -x[1]):
        print("  +%-3d %s  (%s)" % (d, it.get("pessoa", ""), it.get("oracao", "")))
    if faltam:
        print("\nIntenções que só este celular tem (entram no banco): %d" % len(faltam))
        for it in faltam:
            print("  %s  (%s)  contagem %s" % (it.get("pessoa", ""), it.get("oracao", ""),
                                            it.get("contagem", 0)))
    if estranhos:
        print("\nFicam de fora (para decidir à parte):")
        for it, c, b, porque in estranhos:
            print("  %s  (%s): contagem %d, base %d — %s" % (it.get("pessoa", ""),
                                                          it.get("oracao", ""), c, b, porque))

    textos_novos = []
    if banco_textos is not None:
        em = legado.get("textosEm") or {}
        for nome, texto in (legado.get("textos") or {}).items():
            meu = int(em.get(nome) or 0)
            la = banco_textos.get(nome)
            if la is None or meu > int(la.get("editado_em") or 0):
                textos_novos.append({"nome": nome, "texto": texto, "editado_em": meu})
        if textos_novos:
            print("\nTextos de oração mais novos neste celular: %d" % len(textos_novos))
            for t in textos_novos:
                print("  " + t["nome"])

    fila = ((copia.get("estado") or {}).get("fila") or [])
    if fila:
        print("\n(%d %s da versão nova na fila do celular: essas o próprio app envia.)"
              % (len(fila), "reza" if len(fila) == 1 else "rezas"))

    linhas = [{
        "id": str(uuid.uuid5(NS, "recuperada|%s|%s|%s" % (aparelho, marca, it["id"]))),
        "intencao_id": it["id"], "quantidade": d,
        "em": datetime.now(timezone.utc).isoformat(),
        "aparelho": aparelho, "origem": "recuperada",
    } for it, d in somar]
    novas = [{
        "id": it["id"], "pessoa": it.get("pessoa", ""), "oracao": it.get("oracao", ""),
        "frequencia": int(it.get("frequencia") or 1), "contagem_inicial": 0,
        "criado_em": int(it.get("criadoEm") or 0), "editado_em": int(it.get("editadoEm") or 0),
    } for it in faltam]
    # a intenção nova entra com contagem_inicial 0: o que ela tinha no celular
    # vem como reza recuperada (base 0 → delta = contagem inteira)
    return aparelho, linhas, novas, textos_novos


def main():
    args = sys.argv[1:]
    aplicar = "--aplicar" in args
    args = [a for a in args if a != "--aplicar"]
    if not args:
        sys.exit(__doc__)

    banco = None
    if args[0] == "--banco":
        banco = Banco()
        if len(args) == 1:
            for c in banco.ler("copias?select=id,aparelho,motivo,em&order=id"):
                print("  nº %-4s %-20s %-18s %s" % (c["id"], c["aparelho"], c["motivo"], c["em"][:16]))
            return
        linha = banco.ler("copias?select=conteudo&id=eq.%d" % int(args[1]))
        if not linha:
            sys.exit("Não há cópia nº %s" % args[1])
        copia = linha[0]["conteudo"]
    else:
        copia = json.loads(Path(args[0]).read_text(encoding="utf-8"))
        if aplicar:
            banco = Banco()

    banco_itens = banco_textos = None
    if banco:
        banco_itens = {r["id"]: r for r in banco.ler("intencoes?select=id,apagada_em&limit=10000")}
        banco_textos = {r["nome"]: r for r in banco.ler("textos?select=nome,editado_em&limit=10000")}
    else:
        print("(Sem o banco: só o que a cópia diz. Intenções novas e textos não se comparam.)\n")

    aparelho, linhas, novas, textos = analisar(copia, banco_itens, banco_textos)

    if not aplicar:
        if linhas or novas or textos:
            print("\nNada foi gravado. Para somar, repita o comando com --aplicar.")
        return
    if not (linhas or novas or textos):
        print("\nNada a somar.")
        return
    if input("\nSomar isso ao banco? Digite sim: ").strip().lower() != "sim":
        print("Nada foi gravado.")
        return
    banco.gravar("intencoes", novas, "id", ignorar=True)
    banco.gravar("textos", textos, "nome", ignorar=False)
    banco.gravar("rezas", linhas, "id", ignorar=True)
    print("Gravado no banco: %d rezas, %d intenções novas, %d textos. (O que já estava lá, "
          "de uma soma anterior desta mesma cópia, não se repete.)"
          % (sum(l["quantidade"] for l in linhas), len(novas), len(textos)))


if __name__ == "__main__":
    main()
