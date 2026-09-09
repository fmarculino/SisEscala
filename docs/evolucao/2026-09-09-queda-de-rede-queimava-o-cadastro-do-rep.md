# Queda de rede queimava o cadastro do relógio para sempre (09/09/2026)

## O relato

> "o relógio 04 do HMM continua fora de sincronia com os outros 1, 2 e 3, esses relógios têm que
> estar sincronizados; verifique primeiro se todos estão com os mesmos setores selecionados,
> estou desconfiado que o relógio 4 tem alguma coisa diferente e por algum motivo o 4 tem menos
> cadastro do que os outros ativos no relógio."

Na aba **Cobertura de Ponto**, o `REP-iDClass-HMM-04` mostrava **287 escalados fora do relógio**
contra 10 do `HMM-01`, e clicar em "Sincronizar cadastros" não mudava nada.

## Os setores não eram a causa

Primeira medição, e ela descarta a hipótese mais natural:

| relógio | setores vinculados | cadastros no equipamento | com digital |
|---|---|---|---|
| HMM-01 | 160 | 638 | 317 |
| HMM-02 | 160 | 638 | 317 |
| HMM-03 | 160 | 763 | 391 |
| **HMM-04** | **161** | **342** | 259 |

Os quatro atendem exatamente os mesmos 160 setores. O 161º do HMM-04 é o `CSST` raiz — a duplicata
de `CORPO CLÍNICO \ CSST` já registrada no `CLAUDE.md`, que tem 5 lotados e é caso de
`fn_fundir_setor`, não de vínculo de relógio. Ele não explica 296 cadastros de diferença.

Os quatro também estão na **mesma máquina** (`RH04`, `10.110.4.123`, coletor v0.16.0), recebem o
mesmo cron diário de enfileiramento e replicam biometria entre si normalmente (242 cópias
HMM-03 → HMM-04 aplicadas nas últimas 72h, zero falhas).

## A fila conta outra história

```
REP-iDClass-HMM-01: 684 linhas {"enviado":656,"falhou":24,"pendente":4}
REP-iDClass-HMM-02: 665 linhas {"enviado":638,"falhou":23,"pendente":4}
REP-iDClass-HMM-03: 464 linhas {"enviado":449,"falhou":11,"pendente":4}
REP-iDClass-HMM-04: 653 linhas {"enviado":342,"falhou":303,"pendente":8}
                                             ^^^^^^^^^^^^^
   falhou x301: Post "https://10.110.4.19:443/login.fcgi": dial tcp 10.110.4.19:443:
                connectex: A connection attempt failed because the connected party
                did not properly respond after a period of time...
```

A cronologia isola o evento com precisão — só o HMM-04, numa janela de duas horas:

```
2026-09-08T06h  {"HMM-04":116}
2026-09-08T07h  {"HMM-04":123}
2026-09-08T08h  {"HMM-04": 47}
2026-09-08T15h  {"HMM-04": 15}
```

06h–08h UTC são **03h–05h locais**. O equipamento ficou sem responder de madrugada; os outros três,
na mesma máquina e na mesma rede, seguiram normais. Não foi problema do coletor nem da rede da
unidade — foi aquele relógio.

`status = 'falhou'` é **definitivo** desde `20260905110000`. Chamando `fn_cadastro_rep_reprovado`
par a par (medir executando, nunca estimando):

```
279 servidores cujo ULTIMO registro na fila e' 'falhou'
279 deles NAO estao no snapshot do relogio
277 REPROVADOS - nao serao reenfileirados por ninguem
```

**277 pessoas permanentemente fora daquele equipamento**, com o cron enfileirando todo dia e a
função descartando em silêncio.

## Três defeitos empilhados

### A. O coletor reconhecia rede pelo idioma do Windows

`ciclo.ehFalhaDeTransporte` já existia e já fazia a distinção certa — devolver o item para
`pendente` quando a falha é de transporte. Só que classificava por trecho de texto:

```go
"timeout", "deadline exceeded", "connection refused", "no such host",
"network is unreachable", "connection reset", "i/o timeout", "eof",
"tls", "certificado do rep",
```

A mensagem real do Windows não casa com nenhuma delas. A lista foi escrita a partir das mensagens
do Go em Linux, e **o coletor só roda no Windows** — na prática, toda queda de rede queimava o
cadastro da pessoa.

No parque inteiro há **387 falhas de rede** gravadas assim, em três formas:

| ocorrências | mensagem |
|---|---|
| 368 | `connectex: A connection attempt failed because the connected party...` |
| 18 | `connectex: No connection could be made because the target machine actively refused it` |
| 1 | `wsarecv: An existing connection was forcibly closed by the remote host` |

Nenhuma contém `recusou`, que é a marca do que o próprio equipamento devolveu.

**A correção é estrutural, não textual** (v0.17.0): `errors.As` sobre `*url.Error`, `*net.OpError`,
`*net.DNSError` e `net.Error`. O tipo do erro não depende do idioma do sistema operacional nem da
versão do Go. As marcas de texto ficam como rede de segurança para erro que perdeu o tipo em algum
`fmt.Errorf("%v")`, e ganharam os nomes das syscalls do winsock. A guarda de `recusou` continua
**vindo primeiro**: se o equipamento respondeu, não houve falha de transporte.

### B. A falha já gravada continuava reprovando

Corrigir o coletor não liberta ninguém: as 387 falhas já estão na fila, e coletor antigo continua
em campo (a auto-atualização tem atraso sorteado de até 4h e depende de a máquina estar ligada).

`20260909110000` acrescenta a cláusula (3) a `fn_cadastro_rep_reprovado`: falha de transporte não
reprova. O critério vive em `fn_falha_rep_de_transporte`, **fonte única usada pela função e pela
conferência da migration** — se as duas divergissem, a conferência não valeria nada.

Medido antes de escrever:

```
553 pares (dispositivo, servidor) com alguma falha
324 reprovados hoje
290 deles por falha de TRANSPORTE   <- 275 no HMM-04, 5 em cada irmao
 34 recusa legitima do equipamento  <- CONTINUAM reprovados, e devem continuar
```

As 34 são recusas reais (`PIS já cadastrado`, `Matrícula já cadastrada`, matrícula não numérica).
O conserto delas é achar o cadastro antigo no equipamento, não insistir na fila.

### C. O teto de retentativa media a grandeza errada

Este só apareceu ao conferir se as duas correções acima bastavam — e elas **não bastavam**.

```sql
c_max_tentativas constant integer := 5;
IF NOT p_transitorio OR v_tentativas + 1 >= c_max_tentativas THEN  -- vira 'falhou'
```

Com a espera crescente de `5 min × (tentativas+1)`, cinco tentativas são **~70 minutos**. O HMM-04
ficou ~2h fora: **mesmo com o coletor corrigido, os mesmos 301 cadastros teriam sido queimados.**

O teto existe pelo motivo certo — um relógio *removido* da unidade não pode deixar itens `pendente`
para sempre, invisíveis na tela de erro. O que estava errado era **o que se mede**. Contagem de
tentativas não diz nada sobre o equipamento: cinco tentativas são indistinguíveis entre um blecaute
de uma tarde, um fim de semana com a máquina desligada e um relógio que não existe mais.

`20260909120000` troca a grandeza por **tempo na fila** (7 dias) e põe teto de 60 min na espera
entre tentativas — sem ele, um item com 20 tentativas esperaria 1h45 e o relógio poderia voltar sem
ninguém tentar.

Recusa do equipamento (`p_transitorio = false`) continua indo direto para `falhou` no primeiro
erro, como sempre foi.

## O que fica garantido

- **Falta de energia, queda de rede, switch trocado, máquina desligada no fim de semana**: o item
  continua `pendente`, é retentado a cada ciclo (no máximo de hora em hora), e entra sozinho quando
  o equipamento volta. Nada é perdido.
- **Relógio removido de vez**: depois de 7 dias o item vira `falhou` e aparece na tela — que é o
  comportamento que o teto original queria.
- **Recusa do equipamento**: continua definitiva, e volta a ser tentada depois de 30 dias ou assim
  que o cadastro da pessoa for corrigido (`servidores.updated_at`).

## Sobre o próprio diagnóstico

**Ao investigar "este relógio tem menos cadastro que o irmão", olhe a fila antes dos setores.** Os
dois lados são silenciosos: a tela não distingue "não foi enviado" de "foi recusado para sempre", e
o botão devolve zero sem dizer por quê.

E um achado de passagem que explica por que nada andava sozinho naquele momento: **os quatro
relógios do HMM estavam sem contato desde 08/09 às 19:31 locais** — a máquina RH04 é desligada à
noite. Nenhuma correção de banco produz efeito enquanto o coletor daquela unidade não roda.

## Portões

- `go test ./ciclo/` — `tools/coletor-rep/ciclo/transporte_test.go`, com as mensagens reais de
  produção nos dois sentidos (9 de transporte, 7 de recusa). **Validado injetando três regressões
  de propósito** — remover a detecção estrutural, remover as marcas do Windows, tirar a guarda de
  `recusou` da frente. As três reprovam.
- As duas migrations conferem **os dois sentidos** e abortam se qualquer um quebrar. A de
  `fn_confirmar_cadastro_rep` **executa** a função contra cenário sintético (armadilha 42):
  transitório novo persiste, transitório velho falha, recusa é definitiva, e o guard de dono da
  fila sobreviveu à cópia.

## Arquivos

| arquivo | papel |
|---|---|
| `tools/coletor-rep/ciclo/ciclo.go` | `ehFalhaDeTransporte` estrutural; `ciclo.Versao` 0.17.0 |
| `tools/coletor-rep/ciclo/transporte_test.go` | o portão |
| `supabase/migrations/20260909110000_...` | falha de transporte não reprova |
| `supabase/migrations/20260909120000_...` | transitório não queima por contagem |
| `scratchpad/gen_falha_transporte.js` · `gen_transitorio_por_tempo.js` | os geradores (cópia mecânica) |
| `scratchpad/an_hmm04_sync.mjs` · `an_hmm04_fila.mjs` · `an_connectex.mjs` · `an_reprov_transporte.mjs` | as medições |

## Aplicado e conferido em produção (09/09/2026)

As duas migrations foram aplicadas pelo usuário e conferidas por script que **executa** as funções
(armadilha 42) e sai com código 1 se qualquer asserção falhar.

`scratchpad/ver_migrations_09_09.mjs`:

```
=== A. fn_falha_rep_de_transporte existe e classifica certo ===
  ok   connectex do Windows / actively refused / wsarecv          -> true
  ok   PIS ja cadastrado / matricula / nenhum formato / 401 / NULL -> false
  ok   anon recusado (HTTP 401)

=== B. fn_cadastro_rep_reprovado ===
  pares com falha: 553 | reprovados agora: 34     (eram 324)
  ok   nenhum par com SO falha de transporte continua reprovado
  ok   todo reprovado restante tem ao menos uma recusa do equipamento
```

`scratchpad/ver_transitorio_producao.mjs` (ensaio revertido, linha de fila criada e apagada):

```
  ok   101a tentativa transitoria continua 'pendente'
  ok   contador avancou para 101
  ok   espera com teto (55.7 min; sem teto seriam 505)
  ok   recusa do equipamento continua definitiva
  ok   guard de dono da fila intacto (HTTP 403)
  linha de ensaio apagada
```

⚠️ **A primeira versão da asserção do teto de espera não discriminava nada.** Com 12 tentativas,
`5 min × 13 = 65` e o teto de 60 caem os dois dentro de qualquer folga razoável — e o relógio desta
máquina está ~4 min adiantado em relação ao `now()` do banco, o que borrava ainda mais a diferença.
Com **100** tentativas os dois cenários ficam a 505 min contra 60: aí a asserção prova o teto.

ℹ️ **Os 2 que sobraram no HMM-04 são PAULINO (67469) e ELZENIR (68151)** — as mesmas duas pessoas
de duplo vínculo já registradas no `CLAUDE.md` (mesmo CPF e mesmo PIS em duas matrículas). O PIS já
está no equipamento pela outra matrícula, então `PIS já cadastrado` é a recusa correta; o conserto
é `fn_mesclar_servidores`, não a fila.

⚠️ Falta a parte operacional, e ela não é automática hoje: **enfileirar os 275 do HMM-04** (botão
"Enfileirar cadastros" na aba Cobertura de Ponto, ou esperar o cron da madrugada) e a **máquina
RH04 precisa estar ligada** — o coletor grava 20 cadastros por ciclo de 5 min, então ~275 pessoas
levam cerca de 2 horas.
