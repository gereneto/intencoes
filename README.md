# Intenções

App de intenções de oração. Mostra uma pessoa e uma oração por vez; ao marcar
**Rezei**, a contagem sobe, a tela se apaga por dois segundos e só então a
próxima intenção aparece.

São quatro telas: o sorteio, a lista de **Todas as intenções**, as **Orações**, onde fica
escrito o texto de cada oração, e **Dados**, com a senha, a sincronia e a cópia
(engrenagem no alto da lista). A lista tem busca por pessoa ou oração: primeiro
vêm as que começam pelo que foi digitado, depois as que só o contêm, sem
distinguir maiúscula nem acento. Tocar no nome da oração no sorteio abre o
texto dela num popup, sobre a própria tela, sem perder a intenção de vista. Um
toque em qualquer lugar fecha; de lá se vai à tela Orações para escrever ou
corrigir. Toda tela secundária tem o voltar no alto, à esquerda. O botão de
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
alcançar a fatia que lhe cabe. Se preferir que já entre em dia, ajuste a
contagem dele no formulário da intenção.

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
a caixa mostra na hora de salvar.

O nome da pessoa aceita 200 caracteres; o da oração, 500. O texto da oração não
tem limite.

## Banco e sincronia

Desde 2026-11 as intenções, as contagens e os textos ficam num banco
(Supabase, projeto próprio do app), atrás de uma senha. Antes ficavam num
repositório privado do GitHub, somando diferenças entre os celulares — e um
celular que parasse de sincronizar descasava do outro sem ninguém ver.

**Cada "Rezei" é uma linha** na tabela `rezas`, com a data e o nome do celular.
A contagem de uma intenção é o que ela tinha quando o banco nasceu
(`contagem_inicial`) mais a soma das linhas dela. Nada se soma por diferença,
então os dois aparelhos não têm como descasar: no máximo um deles está atrasado
até a próxima sincronia. O ajuste à mão da contagem vira uma linha com a
diferença (origem `ajuste`).

O celular trabalha sem rede: o que ainda não foi enviado fica numa fila no
aparelho e vai na sincronia seguinte. Cada reza tem um id próprio, então
reenviar não duplica.

Nome, oração e frequência ficam com a edição mais recente; o texto da oração
também. Intenção apagada fica apagada (marcada no banco, não some). Essas regras
moram no próprio banco, em `ferramentas/banco.sql`, e o app só pode acrescentar
rezas: não altera nem apaga nenhuma.

### Senha

Uma conta só, compartilhada pelos dois celulares: o e-mail é fixo no `app.js`
(`SUPA_EMAIL`) e a senha se digita uma vez em cada aparelho, em lista →
engrenagem → Dados, junto com o nome do celular. O aparelho guarda a sessão
(renovada sozinha), nunca a senha. A URL do projeto e a chave pública
(`SUPA_URL`, `SUPA_CHAVE`) estão no `app.js`; a chave é pública por natureza,
quem protege os dados é a senha.

### Quando sincroniza

Ao abrir o app, ao voltar para ele, de cinco em cinco minutos com a tela à
vista, e uns segundos depois de cada mudança.

### A primeira entrada de cada celular

Ao digitar a senha, antes de mexer em qualquer coisa, o celular manda ao banco
uma **cópia inteira** do que guarda (tabela `copias`). Se o banco estiver vazio,
ele pergunta se as intenções dele devem ser o ponto de partida — é o celular
que estiver em dia que faz essa carga. Se o banco já tiver dados, o celular
passa a mostrar o que está lá.

## Cópia deste celular e recuperação

Em Dados, "Enviar ao banco" e "Baixar arquivo" geram a mesma cópia: o estado
atual e, intacto, o que a versão do GitHub deixou no aparelho (chave
`rezarPor.estado.v1`, que nunca mais se regrava). Ali está, por intenção, a
contagem e a "base" — o que o celular acreditava estar no GitHub. `contagem −
base` é o que ele rezou e nunca foi enviado: é registro, não estimativa.

`ferramentas/somar-copia.py` mostra essas rezas e, com `--aplicar`, soma-as ao
banco (origem `recuperada`); intenção que só aquele celular tinha entra junto.
Rodar de novo não soma duas vezes. A senha é pedida no terminal.

```
python3 ferramentas/somar-copia.py --banco          # lista as cópias
python3 ferramentas/somar-copia.py --banco 2        # mostra a nº 2
python3 ferramentas/somar-copia.py --banco 2 --aplicar
python3 ferramentas/somar-copia.py copia.json       # o mesmo, de um arquivo baixado
```

O token antigo do GitHub é apagado do aparelho na primeira abertura desta
versão e nunca entra na cópia.

## A lista

A lista de intenções se ordena por frequência (o padrão), por ordem alfabética,
pela chance atual no sorteio ou pelas mais recentes. A escolha fica guardada no
aparelho; na ordem por recentes, o rodapé de cada linha troca a chance pela
data de criação.

No formulário de uma pessoa nova, "Salvar e criar outra" guarda e já abre a
próxima, herdando a oração e a frequência da anterior — só o nome fica em
branco. É o caminho para cadastrar várias de uma vez.

### Quando cada intenção nasceu

`criadoEm` guarda o instante da criação; entre duas datas para a mesma intenção
fica sempre a mais antiga, porque nascer é uma vez só. As intenções anteriores a
esse campo não precisaram de adivinhação: o `id` sempre foi
`Date.now().toString(36)` mais quatro caracteres ao acaso, então os oito
primeiros caracteres devolvem o instante exato. Das 55 que existiam, 51 foram
recuperadas assim. As outras quatro são `a1` a `a4`, ids escritos à mão no
`dados.js` original: ficam com 0, aparecem como "sem data" e a ordenação por
recentes as põe no fim — que é onde pertencem, por serem as primeiras de todas.

## Arquivos

| arquivo | o que faz |
|---|---|
| `index.html` | as telas: sorteio, intenções, orações, dados, formulário |
| `estilo.css` | aparência |
| `app.js` | sorteio, contagens, edição, textos das orações, sincronia com o banco, cópia |
| `dados.js` | lista inicial embutida — vazia: os dados ficam no banco |
| `ferramentas/banco.sql` | tabelas e regras do banco (rodar uma vez no Supabase) |
| `ferramentas/somar-copia.py` | soma ao banco o que só um celular tinha |
| `sw.js` | cache para uso offline |
| `manifest.json` | instalação na tela de início |
