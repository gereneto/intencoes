/* Intenções — lógica do app.
   Sorteio ponderado pela distância entre o que já foi rezado e a meta. */

(function () {
  "use strict";

  /* O estado mora no aparelho. A chave da versão do GitHub (v1) nunca mais se
     regrava: fica intacta como registro do que o celular tinha antes do banco,
     e vai inteira na cópia enviada ao banco (ver montarCopia).            */
  const CHAVE = "intencoes.estado.v2";
  const CHAVE_LEGADO = "rezarPor.estado.v1";
  const CHAVE_LEGADO_SINC = "rezarPor.sinc.v1";

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

  function lerJSON(chave) {
    try { return JSON.parse(localStorage.getItem(chave) || "null"); } catch (e) { return null; }
  }

  function semSujos() { return { itens: {}, textos: {}, apagadas: {} }; }

  function vazio() {
    return {
      itens: [], textos: {}, textosEm: {},
      fila: [],            // rezas ainda não enviadas ao banco
      sujos: semSujos(),   // edições ainda não enviadas
      ligado: false,       // já conversou com o banco (ou fez a primeira carga)
      copiaInicial: false, // a cópia da primeira entrada já está no banco
      sincEm: 0,
      ordem: "frequencia",
      atual: null
    };
  }

  function normalizar(it) {
    const id = it.id || novoId();
    const contagem = Math.max(0, Math.round(Number(it.contagem) || 0));
    return {
      id: id,
      criadoEm: Math.max(0, Math.round(Number(it.criadoEm) || 0)) || dataDoId(id),
      pessoa: String(it.pessoa || "").trim().slice(0, LIM_PESSOA),
      oracao: String(it.oracao || "").trim().slice(0, LIM_ORACAO),
      frequencia: Math.min(100, Math.max(1, Math.round(Number(it.frequencia) || 1))),
      /* contagem: o que a tela mostra = banco + rezas desta intenção na fila.
         banco: o que o banco tinha na última leitura.                       */
      contagem: contagem,
      banco: Math.round(Number(it.banco != null ? it.banco : contagem) || 0),
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

  function normalizarFila(f) {
    return (Array.isArray(f) ? f : []).filter(r => r && r.id && r.intencao_id).map(r => ({
      id: String(r.id), intencao_id: String(r.intencao_id),
      quantidade: Math.round(Number(r.quantidade) || 0),
      em: String(r.em || new Date().toISOString()),
      origem: String(r.origem || "rezei")
    })).filter(r => r.quantidade !== 0);
  }

  function carregar() {
    const e = vazio();
    const v2 = lerJSON(CHAVE);
    if (v2 && Array.isArray(v2.itens)) {
      e.itens = v2.itens.map(normalizar);
      e.textos = normalizarTextos(v2.textos);
      e.textosEm = normalizarDatas(v2.textosEm);
      e.fila = normalizarFila(v2.fila);
      const s = v2.sujos || {};
      e.sujos = { itens: Object.assign({}, s.itens), textos: Object.assign({}, s.textos),
                  apagadas: normalizarDatas(s.apagadas) };
      e.ligado = !!v2.ligado;
      e.copiaInicial = !!v2.copiaInicial;
      e.sincEm = Number(v2.sincEm) || 0;
      e.ordem = ORDENS[v2.ordem] ? v2.ordem : "frequencia";
      e.atual = v2.atual || null;
      return e;
    }
    /* Primeira abertura desta versão: parte do que a versão do GitHub deixou.
       A contagem vem como está (com o que ainda não tinha chegado ao GitHub);
       quem decide o que vale é a primeira sincronia com o banco.          */
    const v1 = lerJSON(CHAVE_LEGADO);
    const d = (v1 && Array.isArray(v1.itens)) ? v1 : (window.DADOS_ORACOES || {});
    e.itens = (d.itens || []).map(i => normalizar({
      id: i.id, criadoEm: i.criadoEm, pessoa: i.pessoa, oracao: i.oracao,
      frequencia: i.frequencia, contagem: i.contagem, editadoEm: i.editadoEm
    }));
    e.textos = normalizarTextos(d.textos);
    e.textosEm = normalizarDatas(d.textosEm);
    e.ordem = ORDENS[d.ordem] ? d.ordem : "frequencia";
    e.atual = d.atual || null;
    return e;
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
  const popup = $("#popup-oracao");
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
    enfileirar(it.id, 1, "rezei");
    estado.atual = sortear();
    salvar();
    agendarSinc(8000);
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
    estado.textosEm[nome] = Date.now();   // a data viaja: a edição mais recente vence
    estado.sujos.textos[nome] = 1;
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

  /* O texto da oração aparece por cima da tela principal: no meio de uma
     sequência de orações, trocar de tela para ler duas linhas era demais.  */
  function verTextoDaAtual() {
    const it = atual();
    if (!it || !it.oracao) { abrirOracoes(null); return; }

    const nome = nomeCanonico(it.oracao) || it.oracao;
    const texto = estado.textos[nome] || "";

    $("#popup-nome").textContent = nome;
    $("#popup-texto").textContent = texto || "Esta oração ainda não tem texto escrito.";
    $("#popup-texto").classList.toggle("sem-texto", !texto);
    $("#btn-popup-escrever-rotulo").textContent = texto ? "Editar na tela Orações" : "Escrever o texto";
    popup.hidden = false;
    $(".popup-cartao").scrollTop = 0;
    $(".popup-cartao").focus();
  }

  function fecharPopup() {
    popup.hidden = true;
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
    if (n === it.contagem) return;
    enfileirar(it.id, n - it.contagem, "ajuste");
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
      estado.sujos.itens[it.id] = 1;
    } else {
      const agora = Date.now();
      const id = novoId();
      estado.itens.push({ id, pessoa, oracao, frequencia, contagem: 0,
                          banco: 0, criadoEm: agora, editadoEm: agora });
      estado.sujos.itens[id] = 1;
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
    estado.sujos.apagadas[editando] = Date.now();   // no banco fica marcada como apagada
    delete estado.sujos.itens[editando];
    estado.itens = estado.itens.filter(i => i.id !== editando);
    if (estado.atual === editando) estado.atual = sortear();
    salvar();
    agendarSinc(3000);
    fecharForm();
    pintarLista();
    pintarPrincipal();
    avisar("Intenção excluída");
  }

  /* ─────────────────────── Cópia deste celular ───────────────────────
     Tudo o que o aparelho guarda, num arquivo só: o estado atual e, intacto,
     o que a versão do GitHub deixou (com a "base" de cada intenção, que diz
     o que nunca chegou ao GitHub). É daqui que se recupera o que só um
     celular tinha. O token antigo do GitHub nunca entra.                 */

  function montarCopia(motivo) {
    const sincAntiga = lerJSON(CHAVE_LEGADO_SINC);
    if (sincAntiga) delete sincAntiga.token;
    return {
      app: "intencoes",
      formato: 1,
      aparelho: aparelho,
      motivo: motivo,
      em: new Date().toISOString(),
      navegador: navigator.userAgent,
      legado: lerJSON(CHAVE_LEGADO),
      legadoSinc: sincAntiga,
      estado: estado
    };
  }

  function baixarCopia() {
    const copia = montarCopia("arquivo baixado");
    const blob = new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const nome = (aparelho || "celular").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "celular";
    const a = document.createElement("a");
    a.href = url;
    a.download = "intencoes-copia-" + nome + "-" + copia.em.slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    avisar("Cópia baixada");
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
    if (!popup.hidden) { fecharPopup(); return true; }
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

  /* ──────────────────────── Sincronia (Supabase) ────────────────────────
     O banco guarda cada "Rezei" como uma linha; a contagem de uma intenção é
     o que ela tinha quando o banco nasceu mais a soma das linhas dela. O
     celular junta numa fila o que ainda não mandou e, a cada sincronia, manda
     a fila e as edições e depois relê tudo. Nada se soma por diferença, então
     os dois aparelhos não têm como descasar.

     A senha se digita uma vez em cada celular; o que fica guardado é a sessão
     (renovada sozinha), nunca a senha. Edição: a mais recente vence. Intenção
     apagada fica apagada. As regras moram no banco (ferramentas/banco.sql). */

  const SUPA_URL = "";        // https://<projeto>.supabase.co
  const SUPA_CHAVE = "";      // chave pública do projeto (anon / publishable)
  const SUPA_EMAIL = "intencoes@taioe.com.br";
  const CHAVE_SESSAO = "intencoes.sessao.v1";
  const CHAVE_APARELHO = "intencoes.aparelho.v1";

  let sessao = lerJSON(CHAVE_SESSAO);       // { acesso, renovar, expira }
  let aparelho = "";
  try { aparelho = localStorage.getItem(CHAVE_APARELHO) || ""; } catch (e) { aparelho = ""; }
  let sessaoPerdida = false;
  let sincronizando = false;
  let sincPendente = false;
  let sincTimer = null;
  let sincErro = "";

  /* o token do GitHub não serve mais: sai do aparelho (a data fica, é registro) */
  (function () {
    const velha = lerJSON(CHAVE_LEGADO_SINC);
    if (velha && velha.token) {
      try { localStorage.setItem(CHAVE_LEGADO_SINC, JSON.stringify({ em: velha.em || 0, tokenApagado: true })); }
      catch (e) { /* fica para a próxima */ }
    }
  })();

  function bancoNoCodigo() { return !!(SUPA_URL && SUPA_CHAVE); }
  function sincLigada() { return bancoNoCodigo() && !!(sessao && sessao.renovar); }

  function gravarSessao(s) {
    sessao = s;
    try {
      if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { /* sem onde guardar: vale só enquanto o app estiver aberto */ }
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" +
           h.slice(16, 20) + "-" + h.slice(20);
  }

  function enfileirar(id, quantidade, origem) {
    estado.fila.push({ id: uuid(), intencao_id: id, quantidade: quantidade,
                       em: new Date().toISOString(), origem: origem });
  }

  function naFila(id) {
    return estado.fila.reduce((s, r) => s + (r.intencao_id === id ? r.quantidade : 0), 0);
  }

  function pendentes() {
    return estado.fila.length + Object.keys(estado.sujos.itens).length +
           Object.keys(estado.sujos.textos).length + Object.keys(estado.sujos.apagadas).length;
  }

  function recado(status) {
    if (status === 401) return "a senha precisa ser digitada de novo";
    if (status === 403) return "o banco recusou o acesso";
    if (status === 404) return "o banco não tem as tabelas do app";
    if (status >= 500) return "o banco não respondeu";
    return "erro " + status;
  }

  function erroDeRede(e) {
    return e && e.name === "TypeError" ? "sem internet" : (e && e.message) || "falhou";
  }

  /* ── sessão ── */
  async function pedirSessao(corpo, tipo) {
    const r = await fetch(SUPA_URL + "/auth/v1/token?grant_type=" + tipo, {
      method: "POST",
      headers: { "apikey": SUPA_CHAVE, "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      const e = new Error(r.status === 400 ? "senha errada" : recado(r.status));
      e.status = r.status;
      throw e;
    }
    return { acesso: j.access_token, renovar: j.refresh_token,
             expira: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  }

  let renovando = null;
  function tokenDeAcesso(forcar) {
    if (!sessao) return Promise.reject(new Error(recado(401)));
    if (!forcar && sessao.acesso && Date.now() < sessao.expira - 60000) {
      return Promise.resolve(sessao.acesso);
    }
    if (!renovando) {
      renovando = pedirSessao({ refresh_token: sessao.renovar }, "refresh_token")
        .then(function (s) { gravarSessao(s); return s.acesso; })
        .catch(function (e) {
          // recusa do banco derruba a sessão; queda de rede, não
          if (e.status >= 400 && e.status < 500) {
            gravarSessao(null);
            sessaoPerdida = true;
            throw new Error(recado(401));
          }
          throw e;
        })
        .finally(function () { renovando = null; });
    }
    return renovando;
  }

  async function api(caminho, opcoes) {
    opcoes = opcoes || {};
    for (let vez = 0; vez < 2; vez++) {
      const acesso = await tokenDeAcesso(vez > 0);
      const cab = { "apikey": SUPA_CHAVE, "Authorization": "Bearer " + acesso,
                    "Content-Type": "application/json" };
      if (opcoes.prefer) cab["Prefer"] = opcoes.prefer;
      const r = await fetch(SUPA_URL + "/rest/v1/" + caminho, {
        method: opcoes.metodo || "GET", headers: cab, cache: "no-store",
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
      });
      if (r.status === 401 && vez === 0) continue;     // token vencido: renova e tenta de novo
      if (!r.ok) throw new Error(recado(r.status));
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    }
  }

  function gravarLinhas(tabela, linhas, chave, ignorarRepetidas) {
    if (!linhas.length) return Promise.resolve();
    return api(tabela + "?on_conflict=" + chave, {
      metodo: "POST", corpo: linhas,
      prefer: (ignorarRepetidas ? "resolution=ignore-duplicates" : "resolution=merge-duplicates") +
              ",return=minimal"
    });
  }

  function enviarCopia(motivo) {
    return api("copias", {
      metodo: "POST", prefer: "return=minimal",
      corpo: { aparelho: aparelho, motivo: motivo, conteudo: montarCopia(motivo) }
    });
  }

  /* ── primeira conversa deste celular com o banco ──
     Antes de qualquer coisa, a cópia inteira do aparelho vai para o banco:
     sem ela confirmada, nada daqui é trocado pelo que está lá. Se o banco
     estiver vazio, este celular pode ser o ponto de partida.            */
  async function primeiraVez(porOrdem) {
    if (!estado.copiaInicial) {
      await enviarCopia("primeira entrada");
      estado.copiaInicial = true;
      salvar();
    }
    const algum = await api("intencoes?select=id&limit=1");
    if ((algum && algum.length) || !estado.itens.length) {
      estado.ligado = true;
      salvar();
      return;
    }
    if (!porOrdem) { sincErro = "o banco está vazio; toque em Sincronizar agora"; return; }
    const n = estado.itens.length;
    if (!confirm("O banco está vazio. Usar as " + n + " intenções deste celular, com as " +
                 "contagens, como ponto de partida para os dois aparelhos?")) {
      sincErro = "o banco está vazio, esperando a primeira carga";
      return;
    }
    await gravarLinhas("intencoes", estado.itens.map(i => ({
      id: i.id, pessoa: i.pessoa, oracao: i.oracao, frequencia: i.frequencia,
      contagem_inicial: i.contagem, criado_em: i.criadoEm || 0, editado_em: i.editadoEm || 0
    })), "id");
    await gravarLinhas("textos", Object.keys(estado.textos).map(n => ({
      nome: n, texto: estado.textos[n], editado_em: estado.textosEm[n] || 0
    })), "nome");
    // a fila e as edições já estão dentro da carga
    estado.fila = [];
    estado.sujos = semSujos();
    estado.itens.forEach(i => { i.banco = i.contagem; });
    estado.ligado = true;
    salvar();
  }

  /* ── o que este celular tem a mandar ──
     Cada parte só sai da fila depois de gravada; o que mudou durante o envio
     continua marcado e vai na próxima.                                  */
  async function enviarPendencias() {
    const apagadas = Object.assign({}, estado.sujos.apagadas);
    await gravarLinhas("intencoes", Object.keys(apagadas).map(id => ({
      id: id, apagada_em: apagadas[id], editado_em: apagadas[id]
    })), "id");
    Object.keys(apagadas).forEach(id => {
      if (estado.sujos.apagadas[id] === apagadas[id]) delete estado.sujos.apagadas[id];
    });

    const editadas = estado.itens.filter(i => estado.sujos.itens[i.id]).map(i => ({
      id: i.id, pessoa: i.pessoa, oracao: i.oracao, frequencia: i.frequencia,
      criado_em: i.criadoEm || 0, editado_em: i.editadoEm || 0
    }));
    await gravarLinhas("intencoes", editadas, "id");
    Object.keys(estado.sujos.itens).forEach(id => {
      const it = estado.itens.find(i => i.id === id);
      const foi = editadas.find(e => e.id === id);
      if (!it || (foi && foi.editado_em === (it.editadoEm || 0))) delete estado.sujos.itens[id];
    });

    const textos = Object.keys(estado.sujos.textos).map(n => ({
      nome: n, texto: estado.textos[n] || "", editado_em: estado.textosEm[n] || 0
    }));
    await gravarLinhas("textos", textos, "nome");
    textos.forEach(t => {
      if ((estado.textosEm[t.nome] || 0) === t.editado_em) delete estado.sujos.textos[t.nome];
    });

    const lote = estado.fila.slice();
    await gravarLinhas("rezas", lote.map(r => ({
      id: r.id, intencao_id: r.intencao_id, quantidade: r.quantidade,
      em: r.em, aparelho: aparelho, origem: r.origem
    })), "id", true);
    const foram = new Set(lote.map(r => r.id));
    estado.fila = estado.fila.filter(r => !foram.has(r.id));
    salvar();
  }

  /* ── o banco manda: relê tudo e refaz a lista ── */
  async function relerBanco() {
    const lidos = await Promise.all([
      api("intencoes?select=id,pessoa,oracao,frequencia,contagem_inicial,criado_em,editado_em,apagada_em&limit=10000"),
      api("textos?select=nome,texto,editado_em&limit=10000"),
      api("contagens?select=intencao_id,total&limit=10000")
    ]);
    const rItens = lidos[0] || [], rTextos = lidos[1] || [], rTotais = lidos[2] || [];

    const totais = {};
    rTotais.forEach(c => { totais[c.intencao_id] = Number(c.total) || 0; });
    const locais = {};
    estado.itens.forEach(i => { locais[i.id] = i; });
    const noBanco = {};

    const itens = [];
    rItens.forEach(function (r) {
      noBanco[r.id] = 1;
      if (r.apagada_em != null || estado.sujos.apagadas[r.id]) return;
      const L = locais[r.id];
      // editada aqui enquanto a sincronia corria: a versão daqui espera a próxima
      const it = (L && estado.sujos.itens[r.id]) ? L : normalizar({
        id: r.id, pessoa: r.pessoa, oracao: r.oracao, frequencia: r.frequencia,
        criadoEm: r.criado_em, editadoEm: r.editado_em
      });
      it.banco = (Number(r.contagem_inicial) || 0) + (totais[r.id] || 0);
      it.contagem = Math.max(0, it.banco + naFila(r.id));
      itens.push(it);
    });
    // criadas aqui enquanto a sincronia corria
    estado.itens.forEach(function (i) {
      if (!noBanco[i.id] && estado.sujos.itens[i.id]) itens.push(i);
    });

    const textos = {}, textosEm = {};
    rTextos.forEach(function (t) {
      if (estado.sujos.textos[t.nome]) return;
      if (String(t.texto || "").trim()) textos[t.nome] = String(t.texto);
      if (Number(t.editado_em)) textosEm[t.nome] = Number(t.editado_em);
    });
    Object.keys(estado.sujos.textos).forEach(function (n) {
      if (estado.textos[n]) textos[n] = estado.textos[n];
      if (estado.textosEm[n]) textosEm[n] = estado.textosEm[n];
    });

    estado.itens = itens;
    estado.textos = textos;
    estado.textosEm = textosEm;
    if (!atual()) estado.atual = sortear();
    salvar();
  }

  function retrato() {
    return estado.itens.map(i => i.id + ":" + i.contagem + ":" + i.editadoEm).join("|");
  }

  async function sincronizar(porOrdem) {
    if (!sincLigada()) { if (porOrdem) avisar("Falta digitar a senha em Dados"); return; }
    if (sincronizando) { sincPendente = true; return; }
    sincronizando = true;
    sincErro = "";
    pintarSinc();

    const antes = retrato();
    try {
      if (!estado.ligado) await primeiraVez(porOrdem);
      if (estado.ligado) {
        await enviarPendencias();
        await relerBanco();
        estado.sincEm = Date.now();
        salvar();
        if (porOrdem) avisar("Sincronizado");
      } else if (porOrdem && sincErro) {
        avisar("Não sincronizou: " + sincErro);
      }
      const mudou = retrato() !== antes;
      pintarPrincipal();
      if (!telaLista.hidden) pintarLista();
      if (!telaOracoes.hidden && mudou) pintarOracoes(null);
    } catch (e) {
      sincErro = erroDeRede(e);
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
                           atraso == null ? 8000 : atraso);
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
    const pend = pendentes();
    let txt;
    if (!bancoNoCodigo()) {
      txt = "O banco ainda não foi ligado nesta versão do app. Tudo fica guardado neste aparelho.";
    } else if (!sincLigada()) {
      txt = sessaoPerdida
        ? "A senha precisa ser digitada de novo. Enquanto isso, as rezas ficam guardadas neste aparelho."
        : "Desligada. Digite a senha para juntar este celular ao banco." +
          (pend ? "  ·  " + pend + " por enviar" : "");
    } else if (sincronizando) {
      txt = "Sincronizando…";
    } else if (sincErro) {
      txt = "A última tentativa falhou: " + sincErro + "." +
            (pend ? "  ·  " + pend + " por enviar" : "");
    } else {
      txt = "Ligada" + (aparelho ? " como “" + aparelho + "”" : "") + "  ·  " +
            quandoFoi(estado.sincEm) + (pend ? "  ·  " + pend + " por enviar" : "");
    }
    eco.textContent = txt;
    eco.classList.toggle("sinc-erro", !!sincErro || sessaoPerdida);
    // o alerta no alto da tela principal só aparece quando há o que avisar
    $("#sinc-alerta").hidden = !((sincLigada() && sincErro) || sessaoPerdida);
    $("#sinc-campos").hidden = !bancoNoCodigo() || sincLigada();
    $("#btn-sinc-agora").hidden = !sincLigada();
    $("#btn-sinc-sair").hidden = !sincLigada();
    $("#btn-copia-enviar").hidden = !sincLigada();
    if (!$("#sinc-aparelho").value) $("#sinc-aparelho").value = aparelho;
  }

  async function entrar() {
    const nome = $("#sinc-aparelho").value.trim().slice(0, 60);
    const senha = $("#sinc-senha").value;
    if (!nome) { avisar("Falta o nome deste celular"); $("#sinc-aparelho").focus(); return; }
    if (!senha) { avisar("Falta a senha"); $("#sinc-senha").focus(); return; }
    const bt = $("#btn-sinc-entrar");
    bt.disabled = true;
    bt.textContent = "Entrando…";
    try {
      gravarSessao(await pedirSessao({ email: SUPA_EMAIL, password: senha }, "password"));
      aparelho = nome;
      try { localStorage.setItem(CHAVE_APARELHO, nome); } catch (e) { /* fica só nesta sessão */ }
      sessaoPerdida = false;
      $("#sinc-senha").value = "";
      pintarSinc();
      await sincronizar(true);
    } catch (e) {
      avisar("Não entrou: " + erroDeRede(e));
    } finally {
      bt.disabled = false;
      bt.textContent = "Entrar";
    }
  }

  function sair() {
    if (!confirm("Sair do banco neste celular? O que ainda não foi enviado continua guardado aqui.")) return;
    gravarSessao(null);
    sincErro = "";
    pintarSinc();
    avisar("Saiu do banco");
  }

  async function enviarCopiaAgora() {
    try {
      await enviarCopia("botão");
      avisar("Cópia enviada ao banco");
    } catch (e) {
      avisar("A cópia não foi: " + erroDeRede(e));
    }
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
  $("#btn-fechar-popup").addEventListener("click", fecharPopup);

  /* Um toque em qualquer lugar fecha — no fundo escuro ou no próprio cartão.
     Duas exceções: o botão que leva às Orações, que tem o que fazer, e o caso
     de haver texto selecionado, para não fechar na cara de quem está copiando
     a oração. Rolar não fecha: arrastar não gera clique.                   */
  popup.addEventListener("click", function (e) {
    if (e.target.closest("#btn-popup-escrever")) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim()) return;
    fecharPopup();
  });
  $("#btn-popup-escrever").addEventListener("click", function () {
    const nome = $("#popup-nome").textContent;
    fecharPopup();
    abrirOracoes(nome);
  });
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
  $("#btn-copia-baixar").addEventListener("click", baixarCopia);
  $("#btn-copia-enviar").addEventListener("click", enviarCopiaAgora);
  $("#btn-sinc-entrar").addEventListener("click", entrar);
  $("#sinc-senha").addEventListener("keydown", function (e) { if (e.key === "Enter") entrar(); });
  $("#btn-sinc-agora").addEventListener("click", () => sincronizar(true));
  $("#btn-sinc-sair").addEventListener("click", sair);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    fecharTopo();
  });

  $("#campo-oracao").addEventListener("keydown", function (e) {
    if (e.key === "Enter") salvarForm(false);
  });

  salvar();            // primeira abertura desta versão: o estado novo passa a existir
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
