/**
 * Gerador: acrescenta ao CLAUDE.md a armadilha do nome de setor parecido, logo antes da secao
 * "## Convencoes".
 */
import fs from 'node:fs'

const p = 'CLAUDE.md'
let s = fs.readFileSync(p, 'utf8')
const EOL = s.includes('\r\n') ? '\r\n' : '\n'
const eol = t => t.split('\n').join(EOL)

const ancora = `## Convenções`

const novo = `### 66. Campo de texto livre que CRIA cadastro: o dicionário de setores crescia por digitação (14/09/2026)

🚨 **\`resolverDicionarioSetor\` busca o nome com \`.eq('nome', nome)\` e CRIA a entrada quando não
acha** — o campo de nome do setor é texto livre, então o dicionário municipal crescia a cada
digitação. Eram **250 entradas** em ~2 meses, e a família ASG sozinha tinha **5 variações**.

Duas delas eram sinônimo puro e foram padronizadas: \`SERVIÇOS GERAIS\` (**27 setores, 76 lotados,
91 escalas, 640 marcações**) e \`ASG\` (1 setor, 10 lotados). Diário em
[\`docs/evolucao/2026-09-14-padronizacao-asg-e-aviso-de-nome-parecido.md\`](docs/evolucao/2026-09-14-padronizacao-asg-e-aviso-de-nome-parecido.md).

⚠️ **O estrago não fica no cadastro — ele sai pela TRANSFERÊNCIA.** Com dois nomes válidos na mesma
unidade, a árvore de destino oferece os dois e quem aprova escolhe o que **bate com o nome do setor
de origem**: BEATRIZ (mat. 69158) saiu de \`SMS \\ SERVIÇOS GERAIS\` e foi parar sozinha em
\`USF Pedro Cavalcante \\ SERVIÇOS GERAIS\`, ao lado das 4 colegas que estavam no nome certo.

🚨 **A transferência JÁ pedia o destino explicitamente** (\`'Para aprovar a transferência, por favor
selecione a unidade e o setor de destino'\`), a escolha é em árvore de setor único e **nenhum
caminho cria setor sozinho** — o único \`insert\` em \`setores\` é a tela de Setores. Pedir mais uma
confirmação não resolveria: a pessoa confirmaria o mesmo setor errado. **Quando duas opções válidas
existem, a defesa é eliminar a opção errada, não perguntar mais.**

ℹ️ **Renomear setor É repontar \`dicionario_setor_id\`** — o nome mora em \`dicionario_setores\` e
\`setores\` guarda só o id. É o que \`updateSetor\` faz, e é por isso que padronizar 26 unidades não
moveu ponto, escala nem folha: o setor continua sendo o mesmo registro. Unidade que tinha **os
dois** exigiu \`fn_fundir_setor\` (armadilha 27); as outras foram só renomeação.

Fonte única do critério desde então: **\`src/utils/setores/nomeSetor.ts\`**.

| situação | o que acontece |
|---|---|
| idêntico depois de normalizar (\`SERVICOS GERAIS\` × \`SERVIÇOS GERAIS\`) | **reusa a entrada**, sem perguntar — transformar isso em pergunta só ensina a clicar sem ler |
| parecido (\`contido\`, ou uma letra numa palavra longa) | **recusa** e lista os parecidos; segue só com confirmação explícita |
| nome que já está no dicionário | nada — não há entrada nova a criar |

⚠️ **A tela avisa enquanto se digita, mas a tela NÃO é a defesa** (armadilha 33): quem recusa é a
action. E a confirmação **zera a cada tecla** — marcar, trocar o nome e enviar passaria sem que a
nova lista tivesse sido vista.

🚨 **O CRITÉRIO SAIU DE MEDIÇÃO, E A PRIMEIRA VERSÃO ERA INSERVÍVEL:** disparava em **94 dos 248**
nomes (37,9%) e acusava pares legítimos — \`CARDIOLOGIA\` × \`RADIOLOGIA\`, \`MAMOGRAFIA\` ×
\`TOMOGRAFIA\`, \`PORTARIA EXTERNA\` × \`PORTARIA INTERNA\` e \`BLOCO A\` × \`BLOCO B\`. Sugerir fundir
qualquer um desses seria conselho errado, e **aviso que grita à toa é o caminho mais curto para
ninguém mais ler nenhum**. Três cortes levaram a **35 de 248 (14,1%)**, média 1,2 sugestão, com o
caso real continuando pego:

| corte | por quê |
|---|---|
| o lado menor precisa ter **2+ palavras significativas** | com 1 palavra, \`ENFERMAGEM\` pegava \`TEC ENFERMAGEM\`, \`DIRETOR DE ENFERMAGEM\` e \`AMBULATÓRIO DE ENFERMAGEM\` — setores diferentes de verdade |
| distância de edição **por palavra**, nunca sobre o nome inteiro | é o que separa engano de identificador |
| a palavra divergente precisa ter **4+ letras** | em palavra curta uma letra distingue (\`BLOCO A\` × \`BLOCO B\`); em palavra longa é engano (\`MAQUEIRO\` × \`MAQUEIROS\`) |

⚠️ **Ao mexer nesses números, meça o ruído de novo** (\`node scratchpad/an_ruido_nome_setor.mjs\`) —
o critério é calibrado contra o dicionário real, que muda.

ℹ️ Duplicidades que sobraram no dicionário e que o aviso **hoje acusaria**, sem correção aplicada:
\`LABORATORIO\` × \`LABORATÓRIO\` × \`LABORATÓRIOS\`, \`MAQUEIRO\` × \`MAQUEIROS\`,
\`PANEJAMENTO\` × \`PANEJAMENTOS\`. Resolver é fusão caso a caso, com medição própria.

Portões: \`node scratchpad/sim_nome_setor.js\` (40) e \`val_sim_nome_setor.js\` (**7 regressões
injetadas, 7 reprovadas**). Transpile antes com
\`npx tsc src/utils/setores/nomeSetor.ts --outDir scratchpad/_sim --module commonjs --target es2020\`.

${ancora}`

const achou = s.split(eol(ancora)).length - 1
if (achou !== 1) {
  console.error(`ABORTA: ancora "## Convenções" achada ${achou}x, esperado 1x`)
  process.exit(1)
}
s = s.split(eol(ancora)).join(eol(novo))
fs.writeFileSync(p, s)
console.log('CLAUDE.md: armadilha 66 acrescentada')
