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
guardado sozinho, sem botão de salvar. O mesmo texto também se escreve no
formulário da intenção: ao digitar o nome de uma oração que já tem texto, a
caixa o traz. Corrigir o nome não apaga o que está escrito — a caixa só é
trocada quando o nome novo já tiver um texto seu. Renomear a oração de uma intenção leva o
texto junto, se o nome antigo tiver ficado sem uso.

O nome da pessoa aceita 200 caracteres; o da oração, 500. O texto da oração não
tem limite.

## Sincronia automática

Liga-se na tela **Intenções**, em "Sincronizar sozinho". Com ela ligada, os
celulares somam as rezas um do outro sozinhos, sem exportar nada à mão.

### Como montar, uma vez só

1. No GitHub, crie um repositório **privado** novo — por exemplo
   `intencoes-dados` — marcando "Add a README file". Sem esse commit inicial o
   repositório não tem ramo `main` e o app não consegue gravar.
2. Settings → Developer settings → Personal access tokens → **Fine-grained
   tokens** → Generate new token.
   - Repository access: **Only select repositories** → o repositório de dados.
   - Permissions → Repository permissions → **Contents: Read and write**.
   - Validade: a que você quiser; quando vencer, é só gerar outro e colar.
3. No app, tela Intenções → Sincronizar sozinho → **Configurar**. Preencha o
   dono, o nome do repositório de dados e cole o token. "Guardar e sincronizar"
   já faz a primeira troca e cria o `contagens.json` lá dentro.
4. Repita o passo 3 no outro celular, com o mesmo repositório e um token igual.

O token fica no armazenamento do aparelho e nunca entra no `dados.js` nem neste
repositório. Para tirá-lo, "Desligar e apagar o token".

### Quando sincroniza

Ao abrir o app, ao voltar para ele, de cinco em cinco minutos com a tela à
vista, e uns segundos depois de cada mudança — vinte segundos depois de um
"Rezei", três depois de editar ou apagar uma intenção, cinco depois de escrever
o texto de uma oração. Cada sincronia é um commit no repositório de dados.

### Por que as contagens não se perdem

Cada intenção guarda, além da contagem, a **base**: quanto ela tinha na última
sincronia bem-sucedida. O que foi rezado desde então é `contagem − base`, e é
esse delta que se soma ao total que está lá:

```
nova contagem = contagem de lá + (minha contagem − minha base)
```

Se um celular rezou 3 e o outro rezou 1 pela mesma pessoa, os dois terminam com
4. Nenhum sobrescreve o outro.

A regra que sustenta isso: **base é sempre o que este aparelho acredita estar
guardado lá**, e só avança depois de a gravação dar certo. Se a rede cair no
meio, o delta continua de pé e vai na tentativa seguinte.

O resto se resolve por data: nome, oração e frequência ficam com a edição mais
recente; o texto da oração também. Intenção apagada deixa uma lápide, com a
data, que viaja junto — sem ela, o outro celular devolveria a intenção na
sincronia seguinte. As lápides somem depois de 180 dias.

Se dois celulares gravarem ao mesmo tempo, o GitHub recusa o segundo (409); o
app relê, refaz a mescla e grava de novo, até três vezes.

### O `dados.js` continua mandando

Se a `versao` do `dados.js` for maior que a guardada no aparelho, ele vence
como sempre — e, na sincronia seguinte, é empurrado por cima da base
compartilhada, chegando aos dois celulares. É a saída para impor um estado a
tudo de uma vez.

A lista de intenções se ordena por frequência (o padrão), por ordem alfabética
ou pela chance atual no sorteio. A escolha fica guardada no aparelho.

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

Sem a sincronia automática ligada, vale a consequência prática: exporte antes de
trocar de aparelho, e não fique alternando entre dois celulares sem exportar — o
que não foi exportado não viaja. Com ela ligada, isso deixa de ser um problema.

## Arquivos

| arquivo | o que faz |
|---|---|
| `index.html` | as telas: sorteio, intenções, orações, formulário |
| `estilo.css` | aparência |
| `app.js` | sorteio, contagens, edição, textos das orações, sincronia, exportação |
| `dados.js` | as intenções e os textos versionados no GitHub |
| `sw.js` | cache para uso offline |
| `manifest.json` | instalação na tela de início |
