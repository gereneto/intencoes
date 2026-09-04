/* Intenções — lógica do app.
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

  /* Como a lista de intenções se ordena. A chance vem do sorteio, já
     calculada em pintarLista; o desempate é sempre alfabético.          */
  const ORDENS = {
    frequencia: {
      rotulo: "frequência",
      compara: (a, b) => b.it.frequencia - a.it.frequencia ||
                         a.it.pessoa.localeCompare(b.it.pessoa, "pt-BR")
    },
    alfabetica: {
      rotulo: "A–Z",
      compara: (a, b) => a.it.pessoa.localeCompare(b.it.pessoa, "pt-BR")
    },
    chance: {
      rotulo: "chance",
      compara: (a, b) => b.chance - a.chance ||
                         a.it.pessoa.localeCompare(b.it.pessoa, "pt-BR")
    },
    recentes: {
      rotulo: "recentes",
      // sem data conhecida (0) desce para o fim: são as mais antigas de todas
      compara: (a, b) => (b.it.criadoEm || 0) - (a.it.criadoEm || 0) ||
                         a.it.pessoa.localeCompare(b.it.pessoa, "pt-BR")
    }
  };

  let estado = carregar();
  let editando = null;      // id em edição, ou null quando é pessoa nova
  let busca = "";           // filtro da lista; não se guarda entre aberturas
  let pausaRezei = null;    // silêncio de dois segundos depois de "Rezei"

  /* ─────────────────────────── Estado ─────────────────────────── */

  function base() {
    const d = window.DADOS_ORACOES || {};
    return {
      versao: d.versao || 0,
      atualizadoEm: d.atualizadoEm || "",
      itens: (d.itens || []).map(normalizar),
      textos: normalizarTextos(d.textos),
      textosEm: {},
      removidos: {},
      forcarEnvio: false,
      ordem: "frequencia",
      atual: null
    };
  }

  function normalizar(it) {
    const id = it.id || novoId();
    return {
      id: id,
      criadoEm: Math.max(0, Math.round(Number(it.criadoEm) || 0)) || dataDoId(id),
      pessoa: String(it.pessoa || "").trim().slice(0, LIM_PESSOA),
      oracao: String(it.oracao || "").trim().slice(0, LIM_ORACAO),
      frequencia: Math.min(100, Math.max(1, Math.round(Number(it.frequencia) || 1))),
      contagem: Math.max(0, Math.round(Number(it.contagem) || 0)),
      /* base: quanto esta intenção tinha na última sincronia. O que foi rezado
         desde então é contagem − base, e é isso que se soma ao total de lá. */
      base: Math.max(0, Math.round(Number(it.base != null ? it.base : it.contagem) || 0)),
      editadoEm: Math.max(0, Math.round(Number(it.editadoEm) || 0))
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

  /* { chave: instante em ms } — datas de texto escrito e de intenção apagada */
  function normalizarDatas(d) {
    const saida = {};
    if (d && typeof d === "object") {
      Object.keys(d).forEach(function (k) {
        const ms = Math.round(Number(d[k]) || 0);
        if (k && ms > 0) saida[k] = ms;
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
    if ((doArquivo.versao || 0) > (local.versao || 0)) {
      // adoção em bloco: este arquivo passa a ser a verdade, também para quem
      // sincroniza — daí a marca para empurrá-lo por cima da base compartilhada.
      const agora = Date.now();
      doArquivo.itens.forEach(function (i) { i.editadoEm = agora; });
      Object.keys(doArquivo.textos).forEach(function (n) { doArquivo.textosEm[n] = agora; });
      doArquivo.forcarEnvio = true;
      return doArquivo;
    }
    local.itens = local.itens.map(normalizar);
    local.textos = normalizarTextos(local.textos);
    local.textosEm = normalizarDatas(local.textosEm);
    local.removidos = normalizarDatas(local.removidos);
    local.forcarEnvio = !!local.forcarEnvio;
    local.ordem = ORDENS[local.ordem] ? local.ordem : "frequencia";
    return local;
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); }
    catch (e) { avisar("Não foi possível salvar no aparelho"); }
  }

  function novoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* O id sempre carregou o instante da criação: são os oito primeiros
     caracteres, Date.now() em base 36. Dá para saber quando nasceu quase toda
     intenção antiga sem ter guardado nada. Os ids escritos à mão no dados.js
     original ("a1" a "a4") não têm data — ficam com 0, que a ordenação por
     recentes joga para o fim, e é onde de fato pertencem.                 */
  function dataDoId(id) {
    const m = /^([0-9a-z]{8})[0-9a-z]{4}$/.exec(String(id || ""));
    if (!m) return 0;
    const ms = parseInt(m[1], 36);
    if (!isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > Date.now() + 86400000) return 0;
    return ms;
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
  const telaDados = $("#tela-dados");
  const telaForm = $("#tela-form");
  const palco = $("#palco");

  function pintarPrincipal() {
    garantirAtual();
    const it = atual();
    const temItens = estado.itens.length > 0;

    $("#vazio").hidden = temItens;
    palco.hidden = !temItens;
    $("#btn-rezei").hidden = !temItens;
    // durante o silêncio a tela fica apagada, mesmo que chegue uma sincronia
    if (!it || pausaRezei) return;

    $("#oracao-atual").textContent = it.oracao || "Oração";
    $("#pessoa-atual").textContent = it.pessoa || "Sem nome";
    $("#dados-atual").textContent =
      it.contagem + (it.contagem === 1 ? " oração rezada" : " orações rezadas") +
      "  ·  frequência " + it.frequencia;
  }

  /* A contagem sobe na hora; só a tela espera. Dois segundos de escuro entre
     uma intenção e a outra, para a oração não emendar na seguinte.       */
  function marcarRezei() {
    if (pausaRezei) return;
    const it = atual();
    if (!it) return;
    it.contagem += 1;
    estado.atual = sortear();
    salvar();
    agendarSinc();
    if (navigator.vibrate) navigator.vibrate(12);

    palco.classList.remove("trocando");
    palco.classList.add("apagando");
    $("#btn-rezei").disabled = true;

    pausaRezei = setTimeout(function () {
      pausaRezei = null;
      palco.classList.remove("apagando");
      pintarPrincipal();
      void palco.offsetWidth;
      palco.classList.add("trocando");
      $("#btn-rezei").disabled = false;
    }, 2000);
  }

  /* Posto da intenção na busca: quem começa com o que foi digitado vem antes
     de quem só contém, e o nome da pessoa vem antes do nome da oração.
     -1 quer dizer que ficou de fora.                                     */
  function posto(it, alvo) {
    const pessoa = semAcento(it.pessoa);
    const oracao = semAcento(it.oracao);
    if (pessoa.indexOf(alvo) === 0) return 0;
    if (pessoa.indexOf(alvo) > 0) return 1;
    if (oracao.indexOf(alvo) === 0) return 2;
    if (oracao.indexOf(alvo) > 0) return 3;
    return -1;
  }

  function trocarOrdem(qual) {
    if (!ORDENS[qual] || estado.ordem === qual) return;
    estado.ordem = qual;
    salvar();
    pintarLista();
  }

  function pintarOrdem() {
    document.querySelectorAll(".ordem").forEach(function (bt) {
      bt.setAttribute("aria-pressed", bt.dataset.ordem === estado.ordem ? "true" : "false");
    });
  }

  /* 18/08, ou 18/08/2025 quando for de outro ano */
  function dataCurta(ms) {
    const d = new Date(ms);
    const dia = String(d.getDate()).padStart(2, "0");
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const ano = d.getFullYear();
    return dia + "/" + mes + (ano === new Date().getFullYear() ? "" : "/" + ano);
  }

  function pintarBusca() {
    $("#campo-busca").value = busca;
    $("#btn-limpar-busca").hidden = !busca;
  }

  function pintarLista() {
    const lista = $("#lista");
    pintarOrdem();
    $("#btn-limpar-busca").hidden = !busca;
    const ch = chances();
    const somaF = estado.itens.reduce((s, i) => s + i.frequencia, 0) || 1;
    const totalC = estado.itens.reduce((s, i) => s + i.contagem, 0);

    const alvo = semAcento(busca);
    let linhas = estado.itens.map((it, i) => ({ it: it, chance: ch[i] }));
    if (alvo) {
      linhas = linhas
        .map(l => Object.assign(l, { posto: posto(l.it, alvo) }))
        .filter(l => l.posto >= 0);
    }

    const ordem = (ORDENS[estado.ordem] || ORDENS.frequencia).compara;
    linhas.sort(alvo ? ((a, b) => (a.posto - b.posto) || ordem(a, b)) : ordem);

    $("#resumo").textContent = !estado.itens.length
      ? "Nenhuma intenção ainda"
      : alvo
        ? (linhas.length
            ? linhas.length + " de " + estado.itens.length + " intenções"
            : "Nada com “" + busca.trim() + "”")
        : estado.itens.length + " intenções  ·  " + totalC + " orações rezadas";

    lista.innerHTML = "";
    linhas
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
        bt.querySelector(".c2").textContent = estado.ordem === "recentes"
          ? (it.criadoEm ? "criada em " + dataCurta(it.criadoEm) : "sem data")
          : "chance " + (linha.chance * 100).toFixed(1).replace(".", ",") + "%";
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
    estado.textosEm[nome] = Date.now();   // a data viaja: é ela que decide na mescla
    salvar();
    agendarSinc(5000);
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

  /* herdado: ao encadear "salvar e criar outra", a oração e a frequência da
     anterior já vêm preenchidas — quase sempre é o que se quer repetir.  */
  function abrirForm(id, herdado) {
    editando = id || null;
    const it = id ? estado.itens.find(i => i.id === id) : null;
    $("#titulo-form").textContent = it ? "Editar intenção" : "Nova pessoa";
    $("#campo-pessoa").value = it ? it.pessoa : "";
    $("#campo-oracao").value = it ? it.oracao : (herdado ? herdado.oracao : "");
    $("#campo-frequencia").value = it ? it.frequencia : (herdado ? herdado.frequencia : 50);
    $("#btn-excluir").hidden = !it;
    $("#btn-salvar-outra").hidden = !!it;
    $("#bloco-contagem").hidden = !it;
    if (it) ecoarContagem(it);
    ecoarFrequencia();
    contar($("#campo-pessoa"), $("#conta-pessoa"), LIM_PESSOA);
    contar($("#campo-oracao"), $("#conta-oracao"), LIM_ORACAO);
    sugestoesOracao();
    telaForm.hidden = false;
    // depois de aparecer: escondida, a caixa mede zero e não cresce com o texto
    puxarTexto();
    // só a pessoa nova chama o teclado; ao editar, o campo espera o toque
    if (!it) setTimeout(() => $("#campo-pessoa").focus(), 60);
  }

  /* Maiúscula e acento não podem separar duas orações que são a mesma, nem
     atrapalhar a busca: o teclado do celular põe maiúscula sozinho e ninguém
     digita acento sempre igual. "requiem", "Requiem" e "Réquiem" caem todos
     na mesma chave.                                                      */
  function semAcento(txt) {
    return String(txt).trim().toLowerCase()
             .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /* o nome já registrado que corresponde ao digitado, ou "" se for novo */
  function nomeCanonico(nome) {
    const digitado = String(nome).trim().slice(0, LIM_ORACAO);
    if (!digitado) return "";
    if (estado.textos[digitado] !== undefined ||
        estado.itens.some(i => i.oracao === digitado)) return digitado;
    const chave = semAcento(digitado);
    return nomesDeOracoes().find(n => semAcento(n) === chave) || "";
  }

  /* O texto pertence ao nome da oração, não à intenção: várias pessoas
     rezadas com a mesma oração dividem o mesmo texto. Por isso a caixa é um
     espelho do nome que está no campo — trocou o nome, mostra o texto do
     nome novo, e o que estava escrito e não foi salvo se perde.          */
  function puxarTexto() {
    const caixa = $("#campo-texto");
    const nota = $("#nota-texto");
    const digitado = $("#campo-oracao").value.trim().slice(0, LIM_ORACAO);
    const nome = nomeCanonico(digitado);

    caixa.value = nome ? (estado.textos[nome] || "") : "";
    crescer(caixa);

    if (!digitado) { nota.textContent = ""; return; }
    const quantos = nome
      ? estado.itens.filter(i => i.oracao === nome && i.id !== editando).length : 0;
    nota.textContent = caixa.value && quantos
      ? "Texto de “" + nome + "”, que outras " + quantos +
        (quantos === 1 ? " intenção usa." : " intenções usam.")
      : "O texto vale para todas as intenções com esta oração.";
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
    agendarSinc(3000);
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

  function salvarForm(emenda) {
    const pessoa = $("#campo-pessoa").value.trim().slice(0, LIM_PESSOA);
    const digitado = $("#campo-oracao").value.trim().slice(0, LIM_ORACAO);
    const oracao = nomeCanonico(digitado) || digitado;
    const frequencia = Number($("#campo-frequencia").value);

    if (!pessoa) { avisar("Falta o nome da pessoa"); $("#campo-pessoa").focus(); return; }
    if (!oracao) { avisar("Falta o nome da oração"); $("#campo-oracao").focus(); return; }

    if (editando) {
      const it = estado.itens.find(i => i.id === editando);
      it.pessoa = pessoa; it.oracao = oracao; it.frequencia = frequencia;
      it.editadoEm = Date.now();
    } else {
      const agora = Date.now();
      estado.itens.push({ id: novoId(), pessoa, oracao, frequencia, contagem: 0,
                          base: 0, criadoEm: agora, editadoEm: agora });
    }

    // a caixa manda no texto da oração agora nomeada no campo
    const texto = $("#campo-texto").value;
    if (texto !== (estado.textos[oracao] || "")) guardarTexto(oracao, texto);

    const eraEdicao = !!editando;
    salvar();
    agendarSinc(3000);
    pintarLista();
    pintarPrincipal();

    if (emenda) {
      // segue direto para a próxima, sem fechar a folha
      abrirForm(null, { oracao: oracao, frequencia: frequencia });
      avisar("Guardada — agora a próxima");
      return;
    }
    fecharForm();
    avisar(eraEdicao ? "Intenção salva" : "Pessoa adicionada");
  }

  function excluirForm() {
    const it = estado.itens.find(i => i.id === editando);
    if (!it) return;
    if (!confirm("Excluir “" + it.pessoa + "” da lista? A contagem se perde.")) return;
    estado.removidos[editando] = Date.now();   // lápide: impede que volte do outro aparelho
    estado.itens = estado.itens.filter(i => i.id !== editando);
    if (estado.atual === editando) estado.atual = sortear();
    salvar();
    agendarSinc(3000);
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
             ", contagem: " + it.contagem +
             ", criadoEm: " + (it.criadoEm || 0) + " }";
    }).join(",\n");

    const textos = Object.keys(estado.textos)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map(n => "    " + JSON.stringify(n) + ": " + JSON.stringify(estado.textos[n]))
      .join(",\n");

    return "/* Intenções — dados das intenções. Gerado pelo app em " + hoje + ". */\n\n" +
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
    agendarSinc(3000);
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
    if (!telaDados.hidden) { telaDados.hidden = true; return true; }
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

  /* ──────────────────────── Sincronia automática ────────────────────────
     A base compartilhada é um arquivo JSON num repositório privado só de
     dados, gravado pela API do GitHub. Cada aparelho guarda, por intenção,
     quanto ela tinha na última sincronia (base). O que rezou desde então é
     contagem − base, e é esse delta que se soma ao total de lá — assim os
     dois celulares somam em vez de um sobrescrever o outro.

     Regra que sustenta tudo: "base" é sempre o que este aparelho acredita
     estar guardado lá. Só avança depois de a gravação dar certo; se a rede
     falhar, o delta continua de pé e vai na próxima.                    */

  const CHAVE_SINC = "rezarPor.sinc.v1";

  /* Onde fica a base compartilhada. É sempre o mesmo lugar, então não há o que
     perguntar: do aparelho só se pede o token.                            */
  const SINC_DONO = "gereneto";
  const SINC_REPO = "intencoes-dados";
  const SINC_ARQUIVO = "contagens.json";
  const SINC_RAMO = "main";
  const SINC_ALVO = SINC_DONO + "/" + SINC_REPO;
  const ESQUECER_APAGADAS = 180 * 24 * 60 * 60 * 1000;   // 180 dias

  let sinc = carregarSinc();
  let sincronizando = false;
  let sincPendente = false;
  let sincTimer = null;
  let sincErro = "";

  function carregarSinc() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(CHAVE_SINC) || "null"); } catch (e) { s = null; }
    s = s || {};
    return { token: String(s.token || "").trim(), em: Number(s.em) || 0 };
  }

  function salvarSinc() {
    try { localStorage.setItem(CHAVE_SINC, JSON.stringify(sinc)); }
    catch (e) { avisar("Não foi possível guardar a configuração"); }
  }

  function sincLigada() { return !!sinc.token; }

  /* ── base64 que aguenta acento ── */
  function paraBase64(txt) {
    const bytes = new TextEncoder().encode(txt);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function deBase64(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ── API do GitHub ── */
  function urlArquivo() {
    return "https://api.github.com/repos/" +
           encodeURIComponent(SINC_DONO) + "/" + encodeURIComponent(SINC_REPO) +
           "/contents/" + SINC_ARQUIVO.split("/").map(encodeURIComponent).join("/");
  }

  function cabecalhos() {
    return {
      "Authorization": "Bearer " + sinc.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  function recado(status) {
    if (status === 401) return "o token foi recusado";
    if (status === 403) return "o token não tem permissão de escrita";
    if (status === 404) return "repositório não encontrado para este token";
    if (status >= 500) return "o GitHub não respondeu";
    return "erro " + status;
  }

  async function lerRemoto() {
    const url = urlArquivo() + "?ref=" + encodeURIComponent(SINC_RAMO) + "&_=" + Date.now();
    const r = await fetch(url, { headers: cabecalhos(), cache: "no-store" });
    if (r.status === 404) return { dados: baseVazia(), sha: null };   // primeira vez
    if (!r.ok) throw new Error(recado(r.status));
    const j = await r.json();
    let dados;
    try { dados = JSON.parse(deBase64(j.content)); } catch (e) { dados = baseVazia(); }
    return { dados: normalizarRemoto(dados), sha: j.sha };
  }

  /* devolve false quando outro aparelho gravou antes: refaz a mescla */
  async function escreverRemoto(dados, sha) {
    const corpo = {
      message: "Contagens — " + new Date().toISOString().slice(0, 16).replace("T", " "),
      content: paraBase64(JSON.stringify(dados, null, 2)),
      branch: SINC_RAMO
    };
    if (sha) corpo.sha = sha;
    const r = await fetch(urlArquivo(), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, cabecalhos()),
      body: JSON.stringify(corpo)
    });
    if (r.status === 409 || r.status === 422) return false;
    if (!r.ok) throw new Error(recado(r.status));
    return true;
  }

  /* ── forma da base compartilhada ── */
  function baseVazia() { return { atualizadoEm: "", itens: {}, textos: {}, removidos: {} }; }

  function normalizarRemoto(d) {
    const saida = baseVazia();
    if (!d || typeof d !== "object") return saida;
    saida.atualizadoEm = String(d.atualizadoEm || "");
    if (d.itens && typeof d.itens === "object") {
      Object.keys(d.itens).forEach(function (id) {
        const it = normalizar(Object.assign({ id: id }, d.itens[id]));
        it.base = it.contagem;
        saida.itens[id] = it;
      });
    }
    if (d.textos && typeof d.textos === "object") {
      Object.keys(d.textos).forEach(function (n) {
        const t = d.textos[n] || {};
        const nome = String(n).trim().slice(0, LIM_ORACAO);
        if (nome) saida.textos[nome] = { texto: String(t.texto == null ? "" : t.texto),
                                         em: Math.max(0, Math.round(Number(t.em) || 0)) };
      });
    }
    saida.removidos = normalizarDatas(d.removidos);
    return saida;
  }

  function ordenado(obj) {
    const saida = {};
    Object.keys(obj).sort().forEach(function (k) { saida[k] = obj[k]; });
    return saida;
  }

  function paraRemoto() {
    const itens = {};
    estado.itens.forEach(function (i) {
      itens[i.id] = { pessoa: i.pessoa, oracao: i.oracao, frequencia: i.frequencia,
                      contagem: i.contagem, criadoEm: i.criadoEm || 0,
                      editadoEm: i.editadoEm || 0 };
    });
    const textos = {};
    // a data viaja mesmo para o texto apagado: é ela que apaga do outro lado
    Object.keys(estado.textosEm).forEach(function (n) {
      textos[n] = { texto: estado.textos[n] || "", em: estado.textosEm[n] };
    });
    Object.keys(estado.textos).forEach(function (n) {
      if (!textos[n]) textos[n] = { texto: estado.textos[n], em: 0 };
    });
    return {
      atualizadoEm: new Date().toISOString(),
      itens: ordenado(itens),
      textos: ordenado(textos),
      removidos: ordenado(estado.removidos)
    };
  }

  /* ── a mescla ── */
  function mesclar(remoto) {
    const forcar = !!estado.forcarEnvio;
    const corte = Date.now() - ESQUECER_APAGADAS;

    const removidos = {};
    [remoto.removidos, estado.removidos].forEach(function (fonte) {
      Object.keys(fonte).forEach(function (id) {
        if (fonte[id] > corte && (!removidos[id] || fonte[id] > removidos[id])) {
          removidos[id] = fonte[id];
        }
      });
    });

    const locais = {};
    estado.itens.forEach(function (i) { locais[i.id] = i; });

    const ids = Object.keys(locais);
    Object.keys(remoto.itens).forEach(function (id) { if (!locais[id]) ids.push(id); });

    const itens = [];
    ids.forEach(function (id) {
      const L = locais[id], R = remoto.itens[id];
      // apagada em algum aparelho depois da última edição: fica apagada
      if (removidos[id] && removidos[id] >= Math.max((L && L.editadoEm) || 0, (R && R.editadoEm) || 0)) return;

      if (L && R) {
        const delta = forcar ? 0 : (L.contagem - L.base);
        const recente = (L.editadoEm || 0) >= (R.editadoEm || 0) ? L : R;
        // nascer é uma vez só: entre as duas datas fica a mais antiga
        const nasceu = Math.min(L.criadoEm || Infinity, R.criadoEm || Infinity);
        itens.push({
          id: id,
          criadoEm: isFinite(nasceu) ? nasceu : 0,
          pessoa: recente.pessoa, oracao: recente.oracao, frequencia: recente.frequencia,
          contagem: Math.max(0, forcar ? L.contagem : R.contagem + delta),
          base: R.contagem,                     // é o que está guardado lá
          editadoEm: Math.max(L.editadoEm || 0, R.editadoEm || 0)
        });
      } else if (L) {
        itens.push(Object.assign({}, L, { base: 0 }));       // ainda não está lá
      } else {
        itens.push(Object.assign({}, R, { base: R.contagem }));
      }
    });

    const textos = {}, textosEm = {};
    const nomes = {};
    Object.keys(estado.textos).forEach(function (n) { nomes[n] = 1; });
    Object.keys(estado.textosEm).forEach(function (n) { nomes[n] = 1; });
    Object.keys(remoto.textos).forEach(function (n) { nomes[n] = 1; });
    Object.keys(nomes).forEach(function (n) {
      const lEm = estado.textosEm[n] || 0;
      const rEm = remoto.textos[n] ? remoto.textos[n].em : 0;
      const daqui = forcar || lEm >= rEm;
      const txt = daqui ? (estado.textos[n] || "")
                        : (remoto.textos[n] ? remoto.textos[n].texto : "");
      const em = Math.max(lEm, rEm);
      if (txt.trim()) textos[n] = txt;
      if (em) textosEm[n] = em;
    });

    return { itens: itens, textos: textos, textosEm: textosEm, removidos: removidos };
  }

  function aplicarMescla(m) {
    estado.itens = m.itens;
    estado.textos = m.textos;
    estado.textosEm = m.textosEm;
    estado.removidos = m.removidos;
    salvar();
  }

  function retrato() {
    return estado.itens.map(i => i.id + ":" + i.contagem).join("|");
  }

  async function sincronizar(porOrdem) {
    if (!sincLigada()) { if (porOrdem) avisar("A sincronia não está configurada"); return; }
    if (sincronizando) { sincPendente = true; return; }
    sincronizando = true;
    sincErro = "";
    pintarSinc();

    const antes = retrato();
    try {
      let gravou = false;
      for (let tentativa = 0; tentativa < 3 && !gravou; tentativa++) {
        const lido = await lerRemoto();
        aplicarMescla(mesclar(lido.dados));
        gravou = await escreverRemoto(paraRemoto(), lido.sha);
      }
      if (gravou) {
        // o que está lá passa a ser o que está aqui: o delta zera
        estado.itens.forEach(function (i) { i.base = i.contagem; });
        estado.forcarEnvio = false;
        salvar();
        sinc.em = Date.now();
        salvarSinc();
      } else {
        sincErro = "outro aparelho gravou ao mesmo tempo";
      }
      const mudou = retrato() !== antes;
      pintarPrincipal();
      if (!telaLista.hidden) pintarLista();
      if (!telaOracoes.hidden && mudou) pintarOracoes(null);
      if (porOrdem && gravou) avisar("Sincronizado");
    } catch (e) {
      sincErro = e && e.message ? e.message : "falhou";
      if (porOrdem) avisar("Não sincronizou: " + sincErro);
    } finally {
      sincronizando = false;
      pintarSinc();
      if (sincPendente) { sincPendente = false; agendarSinc(3000); }
    }
  }

  function agendarSinc(atraso) {
    if (!sincLigada()) return;
    clearTimeout(sincTimer);
    sincTimer = setTimeout(function () { sincronizar(false); },
                           atraso == null ? 20000 : atraso);
  }

  /* ── a tela da sincronia ── */
  function quandoFoi(ms) {
    if (!ms) return "ainda não sincronizou";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 90) return "agora há pouco";
    const m = Math.round(s / 60);
    if (m < 60) return "há " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "há " + h + (h === 1 ? " hora" : " horas");
    return "há " + Math.round(h / 24) + " dias";
  }

  function pintarSinc() {
    const eco = $("#sinc-estado");
    if (!eco) return;
    const pendente = estado.itens.reduce((s, i) => s + Math.abs(i.contagem - i.base), 0);
    let txt;
    if (!sincLigada()) {
      txt = "Desligada. As contagens ficam só neste aparelho.";
    } else if (sincronizando) {
      txt = "Sincronizando…";
    } else if (sincErro) {
      txt = "A última tentativa falhou: " + sincErro + ".";
    } else {
      txt = "Ligada em " + SINC_ALVO + "  ·  " + quandoFoi(sinc.em) +
            (pendente ? "  ·  " + pendente + " por enviar" : "");
    }
    eco.textContent = txt;
    eco.classList.toggle("sinc-erro", !!sincErro);
    // o alerta no alto da tela principal só aparece quando há o que avisar
    $("#sinc-alerta").hidden = !(sincLigada() && sincErro);
    $("#btn-sinc-desligar").hidden = !sincLigada();
    $("#btn-sinc-agora").hidden = !sincLigada();
    $("#btn-sinc-config").textContent = sincLigada() ? "Trocar o token" : "Configurar";
  }

  function abrirConfigSinc() {
    const campos = $("#sinc-campos");
    campos.hidden = !campos.hidden;
    if (campos.hidden) return;
    $("#sinc-alvo").textContent = SINC_ALVO;
    $("#sinc-token").value = "";
    $("#sinc-token").placeholder = sinc.token ? "token guardado — preencha só para trocar" : "github_pat_…";
    setTimeout(() => $("#sinc-token").focus(), 60);
  }

  function guardarConfigSinc() {
    const token = $("#sinc-token").value.trim();
    if (!token) { avisar("Falta o token"); return; }
    sinc.token = token;
    salvarSinc();
    $("#sinc-token").value = "";
    $("#sinc-campos").hidden = true;
    pintarSinc();
    sincronizar(true);
  }

  function desligarSinc() {
    if (!confirm("Desligar a sincronia e apagar o token deste aparelho?")) return;
    sinc.token = ""; sinc.em = 0;
    salvarSinc();
    pintarSinc();
    avisar("Sincronia desligada");
  }

  /* ─────────────────────────── Ligações ─────────────────────────── */

  $("#btn-rezei").addEventListener("click", marcarRezei);
  $("#btn-nova").addEventListener("click", () => abrirForm(null));
  $("#btn-nova-2").addEventListener("click", () => abrirForm(null));
  $("#btn-primeira").addEventListener("click", () => abrirForm(null));
  function fecharLista() { telaLista.hidden = true; pintarPrincipal(); }

  $("#btn-lista").addEventListener("click", function () {
    busca = "";
    pintarBusca();
    pintarLista();
    telaLista.hidden = false;
  });
  $("#campo-busca").addEventListener("input", function () {
    busca = $("#campo-busca").value;
    pintarLista();
  });
  $("#btn-limpar-busca").addEventListener("click", function () {
    busca = "";
    pintarBusca();
    pintarLista();
    $("#campo-busca").focus();
  });
  $("#sinc-alerta").addEventListener("click", function () {
    pintarSinc();
    telaDados.hidden = false;
  });
  $("#btn-voltar").addEventListener("click", fecharLista);
  $("#btn-voltar-topo").addEventListener("click", fecharLista);
  $("#btn-dados").addEventListener("click", function () {
    pintarSinc();
    telaDados.hidden = false;
  });
  $("#btn-voltar-dados").addEventListener("click", function () { telaDados.hidden = true; });
  $("#btn-oracoes").addEventListener("click", () => abrirOracoes(null));
  $("#oracao-atual").addEventListener("click", verTextoDaAtual);
  $("#btn-voltar-oracoes").addEventListener("click", function () { telaOracoes.hidden = true; });
  $("#btn-cancelar").addEventListener("click", fecharForm);
  $("#btn-salvar").addEventListener("click", function () { salvarForm(false); });
  $("#btn-salvar-outra").addEventListener("click", function () { salvarForm(true); });
  $("#btn-excluir").addEventListener("click", excluirForm);
  $("#btn-ajustar").addEventListener("click", ajustarContagem);
  $("#campo-frequencia").addEventListener("input", ecoarFrequencia);
  $("#campo-pessoa").addEventListener("input", function () {
    contar($("#campo-pessoa"), $("#conta-pessoa"), LIM_PESSOA);
  });
  $("#campo-oracao").addEventListener("input", function () {
    contar($("#campo-oracao"), $("#conta-oracao"), LIM_ORACAO);
    puxarTexto();
  });
  $("#campo-oracao").addEventListener("blur", function () {
    // "requiem" digitado vira o "Requiem" que já existe, para não nascer
    // uma segunda oração com o mesmo nome e outro texto
    const certo = nomeCanonico($("#campo-oracao").value);
    if (certo && certo !== $("#campo-oracao").value.trim()) {
      $("#campo-oracao").value = certo;
      puxarTexto();
    }
  });
  $("#campo-texto").addEventListener("input", function () {
    crescer($("#campo-texto"));
  });
  document.querySelectorAll(".ordem").forEach(function (bt) {
    bt.addEventListener("click", () => trocarOrdem(bt.dataset.ordem));
  });
  $("#btn-copiar").addEventListener("click", copiarArquivo);
  $("#btn-baixar").addEventListener("click", baixarArquivo);
  $("#btn-zerar").addEventListener("click", zerarContagens);
  $("#btn-sinc-config").addEventListener("click", abrirConfigSinc);
  $("#btn-sinc-guardar").addEventListener("click", guardarConfigSinc);
  $("#btn-sinc-agora").addEventListener("click", () => sincronizar(true));
  $("#btn-sinc-desligar").addEventListener("click", desligarSinc);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    fecharTopo();
  });

  $("#campo-oracao").addEventListener("keydown", function (e) {
    if (e.key === "Enter") salvarForm(false);
  });

  pintarPrincipal();
  pintarSinc();

  /* ── quando sincronizar ──
     ao abrir, ao voltar para o app, de cinco em cinco minutos com a tela
     à vista, e alguns segundos depois de cada mudança (ver agendarSinc). */
  if (sincLigada()) agendarSinc(1500);

  document.addEventListener("visibilitychange", function () {
    if (!sincLigada()) return;
    if (document.visibilityState === "visible") agendarSinc(800);
    else { clearTimeout(sincTimer); sincronizar(false); }   // sai devendo nada
  });

  // no celular o app às vezes é encerrado sem passar por visibilitychange
  window.addEventListener("pagehide", function () {
    if (sincLigada()) { clearTimeout(sincTimer); sincronizar(false); }
  });

  setInterval(function () {
    if (sincLigada() && document.visibilityState === "visible") sincronizar(false);
  }, 5 * 60 * 1000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }
})();
