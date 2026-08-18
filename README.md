# Rezar por

App de intenções de oração. Mostra uma pessoa e uma oração por vez; ao marcar
**Rezei**, a contagem sobe e a próxima intenção é sorteada.

São três telas: o sorteio, a lista de **Intenções** e as **Orações**, onde fica
escrito o texto de cada oração. Tocar no nome da oração no sorteio abre o texto
dela. O botão de voltar do aparelho fecha a tela aberta e, na tela principal,
não faz nada — nunca sai do app.

## Publicar

1. Crie o repositório e envie todos os arquivos desta pasta na raiz.
2. Settings → Pages → Deploy from a branch → `main` / `root`.
3. Abra o endereço no celular e use "Adicionar à Tela de Início".

Funciona offline depois da primeira abertura (service worker).

## Como o sorteio decide

Cada intenção tem uma frequência de 1 a 100. O número só vale por comparação:
100, 50 e 3 significam que, a cada 100 aparições da primeira, a segunda aparece
50 vezes e a terceira 3.

A cada sorteio o app calcula, para cada intenção:

- **fatia devida** = frequência ÷ soma das frequências;
- **devido** = fatia × (total de orações já rezadas + 1);
- **desvio** = devido − contagem (positivo = atrasado).

O peso é `fatia × (1 + desvio)`, com duas travas: o desvio é comprimido por uma
tangente hiperbólica (`LIMITE = 4`), para que ninguém muito atrasado monopolize a
tela por dezenas de sorteios seguidos; e há um piso de 15% da fatia, para que
quem está adiantado fique raro, nunca impossível. Ambos os valores estão no topo
de `app.js`.

Em simulação de 15.300 sorteios com frequências 100/50/3, o resultado foi
10.001 / 5.000 / 299 — proporção 33,4 : 16,7 : 1,0 contra o alvo 33,3 : 16,7 : 1,0.

Quem entra novo na lista aparece com muita frequência nos primeiros dias, até
alcançar a fatia que lhe cabe. Se preferir que já entre em dia, edite a
`contagem` inicial dele no `dados.js`.

## Orações

A tela **Orações** reúne todo nome de oração que aparece nas intenções, mais os
que já têm texto guardado. Cada nome abre um campo onde o texto é escrito e
guardado sozinho, sem botão de salvar. Renomear a oração de uma intenção leva o
texto junto, se o nome antigo tiver ficado sem uso.

O nome da pessoa aceita 200 caracteres; o da oração, 500. O texto da oração não
tem limite.

## Dados

- O app trabalha com uma cópia local no aparelho (`localStorage`) — contagens e
  textos das orações.
- `dados.js` é a cópia guardada no GitHub.
- Na tela **Intenções**, "Copiar dados.js" ou "Baixar dados.js" gera o arquivo já
  com as contagens atuais e a versão somada em 1. Substitua o `dados.js` do
  repositório por ele.
- Ao abrir o app, se a `versao` do `dados.js` for maior que a guardada no
  aparelho, o arquivo do GitHub vence. É assim que um segundo celular recebe a
  atualização. Fora isso, prevalece o aparelho.

Consequência prática: exporte antes de trocar de aparelho, e não fique alternando
entre dois celulares sem exportar — o que não foi exportado não viaja.

## Arquivos

| arquivo | o que faz |
|---|---|
| `index.html` | as telas: sorteio, intenções, orações, formulário |
| `estilo.css` | aparência |
| `app.js` | sorteio, contagens, edição, textos das orações, exportação |
| `dados.js` | as intenções e os textos versionados no GitHub |
| `sw.js` | cache para uso offline |
| `manifest.json` | instalação na tela de início |
