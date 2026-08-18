/* Rezar por — lógica do app.
   Sorteio ponderado pela distância entre o que já foi rezado e a meta. */

(function () {
  "use strict";

  const CHAVE = "rezarPor.estado.v1";

  /* Parâmetros do sorteio -------------------------------------------------
     LIMITE  quanto o desvio pode empurrar o peso (evita que quem está muito
             atrasado monopolize a tela por dezenas de sorteios seguidos).
     PISO    peso mínimo, em fração do peso-alvo, para quem já está adiantado:
             continua raro, mas nunca impossível.                          */
  const LIMITE = 4;
  const PISO = 0.15;

  /* Limites de escrita: o nome da pessoa é curto, o da oração pode trazer
     uma pequena descrição ("Jaculatória a São Josemaría pelos autores").   */
  const LIM_PESSOA = 200;
  const LIM_ORACAO = 500;

  const ORACOES_COMUNS = [
    "Memorare", "Ave-Maria", "Pai-Nosso", "Salve-Rainha", "Angelus",
    "Terço", "Uma dezena do terço", "Comunhão espiritual", "Réquiem æternam",
    "Jaculatória", "Oração a São Josemaría", "Oferecimento de obras",
    "Estação ao Santíssimo", "Missa"
  ];

  let estado = carregar();
  let editando = null;      // id em edição, ou null quando é pessoa nova

  /* ─────────────────────────── Estado ─────────────────────────── */

  function base() {
    const d = window.DADOS_ORACOES || {};
    return {
      versao: d.versao || 0,
      atualizadoEm: d.atualizadoEm || "",
      itens: (d.itens || []).map(normalizar),
      textos: normalizarTextos(d.textos),
      atual: null
    };
  }

  function normalizar(it) {
    return {
      id: it.id || novoId(),
      pessoa: String(it.pessoa || "").trim().slice(0, LIM_PESSOA),
      oracao: String(it.oracao || "").trim().slice(0, LIM_ORACAO),
      frequencia: Math.min(100, Math.max(1, Math.round(Number(it.frequencia) || 1))),
      contagem: Math.max(0, Math.round(Number(it.contagem) || 0))
    };
  }

  /* textos: { "nome da oração": "texto inteiro" } */
  function normalizarTextos(t) {
    const saida = {};
    if (t && typeof t === "object") {
      Object.keys(t).forEach(function (k) {
        const nome = String(k).trim().slice(0, LIM_ORACAO);
        const texto = t[k] == null ? "" : String(t[k]);
        if (nome && texto.trim()) saida[nome] = texto;
      });
    }
    return saida;
  }

  function carregar() {
    const doArquivo = base();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) { local = null; }
    if (!local || !Array.isArray(local.itens)) return doArquivo;
    // Arquivo do GitHub mais novo vence: é assim que outro aparelho se atualiza.
    if ((doArquivo.versao || 0) > (local.versao || 0)) return doArquivo;
    local.itens = local.itens.map(normalizar);
    local.textos = normalizarTextos(local.textos);
    return local;
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); }
    catch (e) { avisar("Não foi possível salvar no aparelho"); }
  }

  function novoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ─────────────────────────── Sorteio ─────────────────────────── */

  function pesos() {
    const somaF = estado.itens.reduce((s, i) => s + i.frequencia, 0);
    const totalC = estado.itens.reduce((s, i) => s + i.contagem, 0);
    if (!somaF) return estado.itens.map(() => 1);
    return estado.itens.map(function (it) {
      const alvo = it.frequencia / somaF;          // fatia que lhe cabe no total
      const devido = alvo * (totalC + 1);          // quanto já deveria ter recebido
      const desvio = devido - it.contagem;         // positivo = atrasado
      const suave = LIMITE * Math.tanh(desvio / LIMITE);
      return Math.max(alvo * PISO, alvo * (1 + suave));
    });
  }

  function sortear() {
    if (!estado.itens.length) return null;
    const p = pesos();
    const soma = p.reduce((a, b) => a + b, 0);
    let r = Math.random() * soma;
    for (let i = 0; i < estado.itens.length; i++) {
      r -= p[i];
      if (r <= 0) return estado.itens[i].id;
    }
    return estado.itens[estado.itens.length - 1].id;
  }

  function chances() {
    const p = pesos();
    const soma = p.reduce((a, b) => a + b, 0) || 1;
    return p.map(v => v / soma);
  }

  function atual() {
    return estado.itens.find(i => i.id === estado.atual) || null;
  }

  function garantirAtual() {
    if (!atual()) {
      estado.atual = sortear();
      salvar();
    }
  }

  /* ─────────────────────────── Telas ─────────────────────────── */

  const $ = s => document.querySelector(s);
  const telaLista = $("#tela-lista");
  const telaOracoes = $("#tela-oracoes");
  const telaForm = $("#tela-form");
  const palco = $("#palco");

  function pintarPrincipal() {
    garantirAtual();
    const it = atual();
    const temItens = estado.itens.length > 0;

    $("#vazio").hidden = temItens;
    palco.hidden = !temItens;
    $("#btn-rezei").hidden = !temItens;
    if (!it) return;

    $("#oracao-atual").textContent = it.oracao || "Oração";
    $("#pessoa-atual").textContent = it.pessoa || "Sem nome";
    $("#dados-atual").textContent =
      it.contagem + (it.contagem === 1 ? " oração rezada" : " orações rezadas") +
      "  ·  frequência " + it.frequencia;
  }

  function marcarRezei() {
    const it = atual();
    if (!it) return;
    it.contagem += 1;
    estado.atual = sortear();
    salvar();
    pintarPrincipal();
    palco.classList.remove("trocando");
    void palco.offsetWidth;
    palco.classList.add("trocando");
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function pintarLista() {
    const lista = $("#lista");
    const ch = chances();
    const somaF = estado.itens.reduce((s, i) => s + i.frequencia, 0) || 1;
    const totalC = estado.itens.reduce((s, i) => s + i.contagem, 0);

    $("#resumo").textContent = estado.itens.length
      ? estado.itens.length + " intenções  ·  " + totalC + " orações rezadas"
      : "Nenhuma intenção ainda";

    lista.innerHTML = "";
    estado.itens
      .map((it, i) => ({ it: it, chance: ch[i] }))
      .sort((a, b) => b.it.frequencia - a.it.frequencia ||
                      a.it.pessoa.localeCompare(b.it.pessoa, "pt-BR"))
      .forEach(function (linha) {
        const it = linha.it;
        const devido = (it.frequencia / somaF) * totalC;
        const razao = devido > 0 ? it.contagem / devido : 0;
        const largura = Math.min(100, razao * 70);   // 70% da barra = em dia

        const li = document.createElement("li");
        const bt = document.createElement("button");
        bt.type = "button";
        bt.className = "item";
        bt.innerHTML =
          '<span class="item-topo">' +
            '<span class="item-nome"></span>' +
            '<span class="item-meta"></span>' +
          '</span>' +
          '<span class="item-oracao"></span>' +
          '<span class="barra"><i></i><u style="left:70%"></u></span>' +
          '<span class="item-rodape"><span class="c1"></span><span class="c2"></span></span>';

        bt.querySelector(".item-nome").textContent = it.pessoa;
        bt.querySelector(".item-meta").textContent = it.frequencia;
        bt.querySelector(".item-oracao").textContent = it.oracao;
        const barra = bt.querySelector(".barra i");
        barra.style.width = largura + "%";
        if (razao > 1.05) barra.classList.add("excedente");
        bt.querySelector(".c1").textContent =
          it.contagem + " rezadas · devidas " + devido.toFixed(1);
        bt.querySelector(".c2").textContent =
          "chance " + (linha.chance * 100).toFixed(1).replace(".", ",") + "%";
        bt.addEventListener("click", () => abrirForm(it.id));

        li.appendChild(bt);
        lista.appendChild(li);
      });
  }

  /* ─────────────────────── Orações e seus textos ─────────────────────── */

  /* Todo nome de oração que aparece nas intenções, mais os que já têm texto
     guardado (a intenção pode ter sido apagada; o texto continua servindo). */
  function nomesDeOracoes() {
    const nomes = new Set();
    estado.itens.forEach(i => { if (i.oracao) nomes.add(i.oracao); });
    Object.keys(estado.textos).forEach(n => nomes.add(n));
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function guardarTexto(nome, texto) {
    if (texto.trim()) estado.textos[nome] = texto;
    else delete estado.textos[nome];
    salvar();
  }

  function resumoOracoes(nomes) {
    const comTexto = nomes.filter(n => estado.textos[n]).length;
    $("#resumo-oracoes").textContent = nomes.length
      ? nomes.length + (nomes.length === 1 ? " oração  ·  " : " orações  ·  ") +
        comTexto + " com texto"
      : "Nenhuma oração ainda";
  }

  function crescer(ta) {
    ta.style.height = "auto";
    ta.style.height = (ta.scrollHeight + 2) + "px";
  }

  function pintarOracoes(destaque) {
    const alvo = $("#oracoes");
    const nomes = nomesDeOracoes();
    resumoOracoes(nomes);
    alvo.innerHTML = "";

    nomes.forEach(function (nome) {
      const usos = estado.itens.filter(i => i.oracao === nome).length;

      const li = document.createElement("li");
      const cab = document.createElement("button");
      cab.type = "button";
      cab.className = "oracao-cabeca";
      cab.setAttribute("aria-expanded", "false");
      cab.innerHTML = '<span class="oracao-nome"></span><span class="oracao-meta"></span>';
      cab.querySelector(".oracao-nome").textContent = nome;

      const meta = cab.querySelector(".oracao-meta");
      function pintarMeta() {
        meta.textContent =
          (usos ? usos + (usos === 1 ? " intenção" : " intenções") : "sem intenção") +
          "  ·  " + (estado.textos[nome] ? "com texto" : "sem texto");
      }
      pintarMeta();

      const corpo = document.createElement("div");
      corpo.className = "oracao-corpo";
      corpo.hidden = true;

      const ta = document.createElement("textarea");
      ta.className = "oracao-texto";
      ta.value = estado.textos[nome] || "";
      ta.placeholder = "Escreva aqui o texto de " + nome + "…";
      ta.setAttribute("aria-label", "Texto de " + nome);
      corpo.appendChild(ta);

      /* guarda sozinho: pausa na digitação e ao sair do campo */
      let timer = null;
      ta.addEventListener("input", function () {
        crescer(ta);
        clearTimeout(timer);
        timer = setTimeout(function () {
          guardarTexto(nome, ta.value);
          pintarMeta();
          resumoOracoes(nomesDeOracoes());
        }, 600);
      });
      ta.addEventListener("blur", function () {
        clearTimeout(timer);
        const antes = estado.textos[nome] || "";
        if (antes === ta.value) return;
        guardarTexto(nome, ta.value);
        pintarMeta();
        resumoOracoes(nomesDeOracoes());
        avisar(ta.value.trim() ? "Texto guardado" : "Texto apagado");
      });

      cab.addEventListener("click", function () {
        const abrir = corpo.hidden;
        corpo.hidden = !abrir;
        cab.setAttribute("aria-expanded", abrir ? "true" : "false");
        if (abrir) crescer(ta);
      });

      li.appendChild(cab);
      li.appendChild(corpo);
      alvo.appendChild(li);

      if (destaque && destaque === nome) {
        corpo.hidden = false;
        cab.setAttribute("aria-expanded", "true");
        setTimeout(function () {
          crescer(ta);
          li.scrollIntoView({ block: "start" });
        }, 30);
      }
    });
  }

  function abrirOracoes(destaque) {
    pintarOracoes(destaque || null);
    telaOracoes.hidden = false;
  }

  function verTextoDaAtual() {
    const it = atual();
    if (!it || !it.oracao) { abrirOracoes(null); return; }
    abrirOracoes(it.oracao);
  }

  /* ─────────────────────────── Formulário ─────────────────────────── */

  function abrirForm(id) {
    editando = id || null;
    const it = id ? estado.itens.find(i => i.id === id) : null;
    $("#titulo-form").textContent = it ? "Editar intenção" : "Nova pessoa";
    $("#campo-pessoa").value = it ? it.pessoa : "";
    $("#campo-oracao").value = it ? it.oracao : "";
    $("#campo-frequencia").value = it ? it.frequencia : 50;
    $("#btn-excluir").hidden = !it;
    $("#bloco-contagem").hidden = !it;
    if (it) ecoarContagem(it);
    ecoarFrequencia();
    contar($("#campo-pessoa"), $("#conta-pessoa"), LIM_PESSOA);
    contar($("#campo-oracao"), $("#conta-oracao"), LIM_ORACAO);
    sugestoesOracao();
    telaForm.hidden = false;
    // só a pessoa nova chama o teclado; ao editar, o campo espera o toque
    if (!it) setTimeout(() => $("#campo-pessoa").focus(), 60);
  }

  /* mostra quanto falta só quando o limite está perto */
  function contar(campo, eco, limite) {
    const usado = campo.value.length;
    const perto = usado >= limite - 40;
    eco.hidden = !perto;
    if (!perto) return;
    eco.textContent = usado + " / " + limite;
    eco.classList.toggle("no-limite", usado >= limite);
  }

  function ecoarContagem(it) {
    const somaF = estado.itens.reduce((s, i) => s + i.frequencia, 0) || 1;
    const totalC = estado.itens.reduce((s, i) => s + i.contagem, 0);
    const devido = (it.frequencia / somaF) * totalC;
    $("#eco-contagem").textContent =
      it.contagem + " rezadas  ·  devidas " + devido.toFixed(1).replace(".", ",");
  }

  function ajustarContagem() {
    const it = estado.itens.find(i => i.id === editando);
    if (!it) return;
    const resp = prompt("Quantas orações já foram rezadas por " + it.pessoa + "?", it.contagem);
    if (resp === null) return;
    const n = Math.round(Number(resp.replace(",", ".")));
    if (!isFinite(n) || n < 0) { avisar("Informe um número igual ou maior que zero"); return; }
    it.contagem = n;
    salvar();
    ecoarContagem(it);
    pintarPrincipal();
    avisar("Contagem ajustada");
  }

  function fecharForm() {
    telaForm.hidden = true;
    editando = null;
  }

  function ecoarFrequencia() {
    const v = Number($("#campo-frequencia").value);
    $("#eco-frequencia").textContent = v;
    $("#campo-frequencia").style.setProperty("--preenchido", ((v - 1) / 99 * 100) + "%");

    const outros = estado.itens.filter(i => i.id !== editando);
    if (!outros.length) {
      $("#nota-frequencia").textContent =
        "De 1 a 100. O número só vale em comparação com os outros: quem tem 100 aparece 100 vezes para cada 3 aparições de quem tem 3.";
      return;
    }
    const somaF = outros.reduce((s, i) => s + i.frequencia, 0) + v;
    const fatia = v / somaF * 100;
    $("#nota-frequencia").textContent =
      "Cerca de " + fatia.toFixed(1).replace(".", ",") + "% das orações, ou 1 em cada " +
      Math.round(somaF / v) + ".";
  }

  function sugestoesOracao() {
    const usadas = estado.itens.map(i => i.oracao).filter(Boolean);
    const todas = Array.from(new Set(usadas.concat(ORACOES_COMUNS)));
    $("#oracoes-sugeridas").innerHTML =
      todas.map(o => '<option value="' + o.replace(/"/g, "&quot;") + '">').join("");
  }

  function salvarForm() {
    const pessoa = $("#campo-pessoa").value.trim().slice(0, LIM_PESSOA);
    const oracao = $("#campo-oracao").value.trim().slice(0, LIM_ORACAO);
    const frequencia = Number($("#campo-frequencia").value);

    if (!pessoa) { avisar("Falta o nome da pessoa"); $("#campo-pessoa").focus(); return; }
    if (!oracao) { avisar("Falta o nome da oração"); $("#campo-oracao").focus(); return; }

    if (editando) {
      const it = estado.itens.find(i => i.id === editando);
      const antiga = it.oracao;
      it.pessoa = pessoa; it.oracao = oracao; it.frequencia = frequencia;
      // renomear a oração leva junto o texto, se o nome antigo ficou órfão
      if (antiga && antiga !== oracao && estado.textos[antiga] && !estado.textos[oracao] &&
          !estado.itens.some(i => i.oracao === antiga)) {
        estado.textos[oracao] = estado.textos[antiga];
        delete estado.textos[antiga];
      }
    } else {
      estado.itens.push({ id: novoId(), pessoa, oracao, frequencia, contagem: 0 });
    }
    salvar();
    fecharForm();
    pintarLista();
    pintarPrincipal();
    avisar(editando ? "Intenção salva" : "Pessoa adicionada");
  }

  function excluirForm() {
    const it = estado.itens.find(i => i.id === editando);
    if (!it) return;
    if (!confirm("Excluir “" + it.pessoa + "” da lista? A contagem se perde.")) return;
    estado.itens = estado.itens.filter(i => i.id !== editando);
    if (estado.atual === editando) estado.atual = sortear();
    salvar();
    fecharForm();
    pintarLista();
    pintarPrincipal();
    avisar("Intenção excluída");
  }

  /* ─────────────────────────── Exportar ─────────────────────────── */

  function gerarArquivo() {
    const hoje = new Date().toISOString().slice(0, 10);
    const linhas = estado.itens.map(function (it) {
      return "    { id: " + JSON.stringify(it.id) +
             ", pessoa: " + JSON.stringify(it.pessoa) +
             ", oracao: " + JSON.stringify(it.oracao) +
             ", frequencia: " + it.frequencia +
             ", contagem: " + it.contagem + " }";
    }).join(",\n");

    const textos = Object.keys(estado.textos)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map(n => "    " + JSON.stringify(n) + ": " + JSON.stringify(estado.textos[n]))
      .join(",\n");

    return "/* Rezar por — dados das intenções. Gerado pelo app em " + hoje + ". */\n\n" +
           "window.DADOS_ORACOES = {\n" +
           "  versao: " + ((estado.versao || 0) + 1) + ",\n" +
           '  atualizadoEm: "' + hoje + '",\n' +
           "  itens: [\n" + linhas + "\n  ],\n" +
           "  textos: {\n" + textos + "\n  }\n};\n";
  }

  function marcarExportado() {
    estado.versao = (estado.versao || 0) + 1;
    estado.atualizadoEm = new Date().toISOString().slice(0, 10);
    salvar();
  }

  function copiarArquivo() {
    const txt = gerarArquivo();
    const ok = () => { marcarExportado(); avisar("Copiado — cole no dados.js do repositório"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(ok, () => avisar("O aparelho não deixou copiar"));
    } else {
      const a = document.createElement("textarea");
      a.value = txt; a.style.position = "fixed"; a.style.opacity = "0";
      document.body.appendChild(a); a.select();
      try { document.execCommand("copy"); ok(); }
      catch (e) { avisar("O aparelho não deixou copiar"); }
      document.body.removeChild(a);
    }
  }

  function baixarArquivo() {
    const blob = new Blob([gerarArquivo()], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "dados.js";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    marcarExportado();
    avisar("dados.js gerado");
  }

  function zerarContagens() {
    if (!confirm("Zerar a contagem de todas as intenções?")) return;
    estado.itens.forEach(i => { i.contagem = 0; });
    estado.atual = sortear();
    salvar();
    pintarLista();
    pintarPrincipal();
    avisar("Contagens zeradas");
  }

  /* ─────────────────────────── Aviso ─────────────────────────── */

  let avisoTimer = null;
  function avisar(texto) {
    const el = $("#aviso");
    el.textContent = texto;
    el.classList.add("visivel");
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.classList.remove("visivel"), 2600);
  }

  /* ──────────────────── Botão voltar do aparelho ────────────────────
     Cada folha aberta empurra um degrau no histórico. O "voltar" do
     celular consome um degrau e fecha a folha de cima; quando não há
     mais folha aberta, o degrau é reposto — o botão nunca sai do app,
     no máximo devolve a tela principal.                              */

  function degrau() {
    try { history.pushState({ app: "rezarPor" }, ""); } catch (e) { /* sem histórico */ }
  }

  function fecharTopo() {
    if (!telaForm.hidden) { fecharForm(); return true; }
    if (!telaOracoes.hidden) { telaOracoes.hidden = true; return true; }
    if (!telaLista.hidden) { telaLista.hidden = true; pintarPrincipal(); return true; }
    return false;
  }

  window.addEventListener("popstate", function () {
    degrau();          // repõe o degrau antes de qualquer coisa
    fecharTopo();
  });

  try { history.replaceState({ app: "rezarPor", raiz: true }, ""); } catch (e) { /* idem */ }
  degrau();

  /* ─────────── Arrastar a barra sem chamar o teclado ───────────
     Com texto selecionado num campo, o toque na barra devolvia o foco ao
     campo e o teclado subia. Tira-se o foco e a seleção antes do arrasto. */
  function soltarTeclado() {
    const focado = document.activeElement;
    if (focado && focado !== $("#campo-frequencia") && typeof focado.blur === "function") {
      focado.blur();
    }
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) { try { sel.removeAllRanges(); } catch (e) { /* nada */ } }
  }

  ["pointerdown", "touchstart", "mousedown"].forEach(function (ev) {
    $("#campo-frequencia").addEventListener(ev, soltarTeclado, { passive: true });
  });

  /* ─────────────────────────── Ligações ─────────────────────────── */

  $("#btn-rezei").addEventListener("click", marcarRezei);
  $("#btn-nova").addEventListener("click", () => abrirForm(null));
  $("#btn-nova-2").addEventListener("click", () => abrirForm(null));
  $("#btn-primeira").addEventListener("click", () => abrirForm(null));
  $("#btn-lista").addEventListener("click", function () {
    pintarLista();
    telaLista.hidden = false;
  });
  $("#btn-voltar").addEventListener("click", function () {
    telaLista.hidden = true;
    pintarPrincipal();
  });
  $("#btn-oracoes").addEventListener("click", () => abrirOracoes(null));
  $("#oracao-atual").addEventListener("click", verTextoDaAtual);
  $("#btn-voltar-oracoes").addEventListener("click", function () { telaOracoes.hidden = true; });
  $("#btn-cancelar").addEventListener("click", fecharForm);
  $("#btn-salvar").addEventListener("click", salvarForm);
  $("#btn-excluir").addEventListener("click", excluirForm);
  $("#btn-ajustar").addEventListener("click", ajustarContagem);
  $("#campo-frequencia").addEventListener("input", ecoarFrequencia);
  $("#campo-pessoa").addEventListener("input", function () {
    contar($("#campo-pessoa"), $("#conta-pessoa"), LIM_PESSOA);
  });
  $("#campo-oracao").addEventListener("input", function () {
    contar($("#campo-oracao"), $("#conta-oracao"), LIM_ORACAO);
  });
  $("#btn-copiar").addEventListener("click", copiarArquivo);
  $("#btn-baixar").addEventListener("click", baixarArquivo);
  $("#btn-zerar").addEventListener("click", zerarContagens);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    fecharTopo();
  });

  $("#campo-oracao").addEventListener("keydown", function (e) {
    if (e.key === "Enter") salvarForm();
  });

  pintarPrincipal();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }
})();
