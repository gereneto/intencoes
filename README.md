# Intenções

App de intenções de oração. Mostra uma pessoa e uma oração por vez; ao marcar
**Rezei**, a contagem sobe, a tela se apaga por dois segundos e só então a
próxima intenção aparece.

São quatro telas: o sorteio, a lista de **Todas as intenções**, as **Orações**, onde fica
escrito o texto de cada oração, e **Dados**, com a sincronia e a exportação
(engrenagem no alto da lista). A lista tem busca por pessoa ou oração: primeiro
vêm as que começam pelo que foi digitado, depois as que só o contêm, sem
distinguir maiúscula nem acento. Tocar no nome da oração no sorteio abre o
texto dela. Toda tela secundária tem o voltar no alto, à esquerda. O botão de
voltar do aparelho fecha a tela aberta e, na tela principal, não faz nada —
nunca sai do app.

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
formulário da intenção, numa caixa que é um espelho do nome da oração: ao
digitar o nome, ela mostra o texto daquele nome, e trocar o nome troca o que a
caixa mostra — o que estava escrito e não foi salvo se perde. Maiúscula e
acento não separam orações: digitar `requiem` encontra o `Requiem` já
registrado, e ao sair do campo o nome digitado encosta no que já existe, para
não nascerem duas orações iguais com textos diferentes.

Renomear a oração de uma intenção não leva o texto junto: o nome antigo
continua com o texto dele na tela Orações, e o nome novo começa vazio. É o que
a caixa mostra na hora de salvar. Renomear a oração de uma intenção leva o
texto junto, se o nome antigo tiver ficado sem uso.

O nome da pessoa aceita 200 caracteres; o da oração, 500. O texto da oração não
tem limite.

## Sincronia automática

Liga-se na tela **Dados**, em "Sincronizar sozinho". Com ela ligada, os
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
3. No app, lista → engrenagem → Dados → Sincronizar sozinho →
   **Configurar**. Só o token é pedido: o dono e o repositório estão fixos no
   `app.js` (`SINC_DONO` e `SINC_REPO`). "Guardar e sincronizar" já faz a
   primeira troca e cria o `contagens.json` lá dentro.
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

A lista de intenções se ordena por frequência (o padrão), por ordem alfabética,
pela chance atual no sorteio ou pelas mais recentes. A escolha fica guardada no
aparelho; na ordem por recentes, o rodapé de cada linha troca a chance pela
data de criação.

### Quando cada intenção nasceu

`criadoEm` guarda o instante da criação, e viaja na sincronia — entre duas
datas para a mesma intenção fica sempre a mais antiga, porque nascer é uma vez
só. As intenções anteriores a esse campo não precisaram de adivinhação: o `id`
sempre foi `Date.now().toString(36)` mais quatro caracteres ao acaso, então os
oito primeiros caracteres devolvem o instante exato. Das 55 que existiam, 51
foram recuperadas assim. As outras quatro são `a1` a `a4`, ids escritos à mão
no `dados.js` original: ficam com 0, aparecem como "sem data" e a ordenação por
recentes as põe no fim — que é onde pertencem, por serem as primeiras de todas.

No formulário de uma pessoa nova, "Salvar e criar outra" guarda e já abre a
próxima, herdando a oração e a frequência da anterior — só o nome fica em
branco. É o caminho para cadastrar várias de uma vez.

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
| `index.html` | as telas: sorteio, intenções, orações, dados, formulário |
| `estilo.css` | aparência |
| `app.js` | sorteio, contagens, edição, textos das orações, sincronia, exportação |
| `dados.js` | as intenções e os textos versionados no GitHub |
| `sw.js` | cache para uso offline |
| `manifest.json` | instalação na tela de início |
