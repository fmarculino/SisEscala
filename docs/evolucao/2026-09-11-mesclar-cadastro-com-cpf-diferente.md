# Cadastro duplicado com CPF diferente: a saída que não existia

**11/09/2026 · v2.57.0 · migration `20260911130000`**

## O relato

Na tela de pendências, o grupo **"Nome idêntico — ALANY CHAVES DE ARAÚJO MACEDO · 2 servidores"**
mostrava duas fichas, ambas Ativas, ambas no SAMU-SMS, e embaixo a frase:

> Os cadastros deste grupo têm CPF diferente entre si — pode não ser a mesma pessoa. Confira as
> fichas; a mesclagem exige o mesmo CPF nos dois lados.

O usuário: *"apesar de ter matrículas diferentes e CPF diferente esse cadastro é da mesma pessoa,
cadastraram um outro CPF válido e uma matrícula temporária e acabou duplicando o cadastro"*.

## A saída que a mensagem mandava seguir era circular

O impedimento `cpf_divergente` dizia, no banco: *"Se for a mesma pessoa, corrija o CPF errado na
ficha antes de mesclar"*.

Só que corrigir não dá. Gravar na ficha o CPF que já está no outro cadastro esbarra em
`fn_cpf_ja_cadastrado` — o portão de `createServidor`/`updateServidor` desde que o índice único de
CPF caiu (`20260810140000`) —, e a única saída que ele oferece é marcar **"confirmação de vínculo
adicional"**. Que é exatamente a caixa cujo uso indevido cria a duplicata que a mesclagem existe
para desfazer (armadilha 50). O comentário de `updateServidor` é explícito: aquela flag **só é
gravada como `true`, nunca desligada**.

Ou seja: a tela apontava o problema e mandava fazer o que o sistema não permite. É a **armadilha
44** — instrução que o sistema não cumpre ensina a contornar o sistema.

## O que a medição mostrou, e por que ela mudou o desenho

Antes de escrever qualquer linha, medi produção (2.643 servidores ativos não mesclados):

| | |
|---|---|
| grupos com **nome idêntico** | 62 |
| …com o **mesmo CPF** dos dois lados (já mescláveis) | **61** |
| …com **CPF divergente** | **1** — o caso relatado |
| grupos suspeitos com CPF divergente, no total | **10 de 156** |
| …por **telefone** | 6 |
| …por **e-mail** | 3 (um deles é um endereço compartilhado por **12 pessoas**) |
| …por **nome** | 1 |

🚨 **É isso que decide o critério.** Se a liberação fosse "CPF divergente pode mesclar", os 9
grupos de telefone e e-mail ganhariam botão — e ali mesclar junta **duas pessoas diferentes**, com
o ponto de uma virando ponto da outra, sem desfazer. O critério do agrupamento, que é irrelevante
no caminho de CPF igual (armadilha 50), passa a ser **decisivo** aqui.

### E não era só o CPF que divergia

Medindo as duas fichas do caso relatado:

| | mat **54546** | mat **T2600120** |
|---|---|---|
| CPF | 519.384.132-53 | 024.527.712-95 |
| PIS | 26770211457 | 14847162079 |
| Nascimento | **08/06/1981** | **10/12/2001** |
| Nome da mãe | **RAIMUNDA CHAVES DE ARAUJO** | **DACILENE SEVERO CIRQUEIRA** |
| Criado em | 08/09 22:14 | 08/09 21:49 |

Mesma unidade, mesmo cargo, mesmo telefone, 25 minutos de diferença — assinatura clássica de
recadastro por engano. Mas **seis** campos de identidade divergem (com nome do pai e RG, medidos
depois de aplicar).

🚨 **Uma tela que perguntasse só "os CPFs são diferentes, confirma?" esconderia justamente o que
decide.** Data de nascimento com 20 anos de diferença e nome da mãe diferente não são detalhe de
digitação: sugerem que a ficha duplicada foi preenchida com os dados de **outra pessoa** — caso em
que não é duplicidade, é ficha trocada, e o conserto é outro.

Por isso a peça central da mudança não é a escotilha, é **`fn_divergencias_identidade_servidor`**.

## O que foi feito

### Banco (`20260911130000`)

| função | o que muda |
|---|---|
| `fn_texto_identidade_normalizado` (nova) | caixa alta, sem acento, sem espaço duplo — só para **comparar**; a tela sempre exibe o valor bruto |
| `fn_divergencias_identidade_servidor` (nova) | uma linha por campo de identidade **preenchido nos dois** e diferente. Campo vazio de um lado **não** é divergência |
| `fn_impedimentos_mesclagem_servidor` | ganha `p_confirmar_identidade` (`DEFAULT false`). **Só** o `cpf_divergente` é suprimido |
| `fn_mesclar_servidores` | ganha `p_confirmar_identidade` (`DEFAULT false`), exige **motivo escrito** e **não copia campo de pessoa** quando a declaração é efetiva |

**Cinco decisões que não podem ser desfeitas:**

1. **`DEFAULT false` nos dois lados.** Quem não declara continua barrado — o lado seguro é o
   default (armadilha 41). As assinaturas antigas foram **derrubadas**: duas sobrecargas fariam o
   PostgREST devolver `PGRST203` na chamada que a tela já fazia.
2. **A declaração só tem efeito quando o CPF DE FATO diverge** (`v_declarada`). Sem essa conjunção,
   `p_confirmar_identidade` viraria uma chave que muda o comportamento de **toda** mesclagem,
   inclusive as 61 normais, onde ela não tem nada a autorizar.
3. **Motivo obrigatório, mínimo 10 caracteres.** Nas outras mesclagens o CPF igual é a prova; nesta,
   a única prova que vai existir é o que a pessoa escreveu. O texto vai para o `motivo_inativacao`
   da ficha que sai e para o log, junto com a lista de campos divergentes.
4. 🚨 **Com identidade declarada, NENHUM campo de pessoa é copiado** — nem para preencher campo
   vazio. No caminho normal, completar é ganho puro porque o CPF igual prova que as duas fichas
   descrevem a mesma pessoa. Aqui não há essa prova: copiar traria o PIS ou a data de nascimento de
   um terceiro para o cadastro correto, **em silêncio**, porque a cópia só alcança campo vazio —
   que é justamente onde ninguém olha.
5. **`sem_cpf` continua duro.** Sem CPF em lado nenhum não há nem o que declarar.

### Tela

O grupo de nome idêntico com CPF divergente ganha selo **`CPF diferente`** (âmbar, nunca o mesmo
"dá para mesclar" azul do caso normal) e o botão **"Conferir e mesclar"**, que abre modal próprio:
tabela das diferenças lado a lado, escolha de qual fica, checkbox de declaração, motivo
obrigatório, botão vermelho "Mesclar assim mesmo". Nada nasce marcado.

A regra de quando oferecer vive em `src/utils/mesclagemCadastro.ts` (`mesclagemDoGrupoDuplicidade`
→ `declaravel`): **só nome idêntico, exatamente 2 cadastros, os dois Ativos, os dois com CPF
válido**. Cada recusa sai com o motivo escrito.

### E um defeito encontrado de passagem

As **5 server actions** de mesclagem ainda exigiam `super_admin` e não acompanharam a v2.56.0, que
abriu a mesclagem ao RH Geral **no banco** — a tela oferecia o botão e a action recusava. É a
armadilha 44 de novo, e agora o papel vem de `@/utils/escopoGestao`, a mesma fonte que a página usa.

## O que quebrou no caminho

- **`RAISE EXCEPTION` exige string LITERAL.** `RAISE EXCEPTION 'a ' || 'b'` dá `42601`, e só na
  execução do `CREATE` — nenhum `tsc`/`build` vê. O usuário levou esse erro ao aplicar a primeira
  versão em produção.
- **`scratchpad/envia_homolog.mjs` não conhecia o delimitador `$fn$;`** e juntava a migration
  inteira num statement só, o que faz o erro de sintaxe voltar sem dizer onde está. Corrigido.
- **O verificador de produção caiu na armadilha 8**: sem paginar, leu 1.000 servidores dos 2.643 e
  concluiu que o par que motivou a mudança **não existia**. Um verificador sem paginação não
  "falha" — ele mente com confiança.

## Portões

| portão | o quê |
|---|---|
| `node scratchpad/sim_mesclagem_da_lista.js` | 44 asserções |
| `node scratchpad/val_sim_mesclagem_da_lista.js` | **8 regressões injetadas, 8 reprovadas** — entre elas liberar telefone/e-mail, 3+ cadastros, cadastro inativo e dispensar o motivo |
| `node scratchpad/gen_mesclagem_declarada.js` | cópia mecânica, 14 invariantes antes e 12 depois |
| homologação | ensaio sintético revertido, **9 de 9** — inclui a prova de que o caminho de CPF igual **continua** completando campo vazio |
| `node scratchpad/ver_mesclagem_declarada_producao.mjs` | confere em produção **executando** as funções, sem escrever nada |

⚠️ A conferência em produção **não chama `fn_mesclar_servidores`**, nem no caminho que deveria
recusar: se a recusa falhasse, ela mesclaria dois cadastros de servidor público sem desfazer. Esse
caminho foi provado em homologação, contra dados sintéticos revertidos.
