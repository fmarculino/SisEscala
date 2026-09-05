# Os indicadores do painel e o corte de 1000 nos relatórios (05/09/2026)

**Versão 2.42.0.** Nenhuma migration — todo o defeito era de leitura e de apresentação; nenhum
horário, hora normal, falta ou folha se move.

## Como começou

O usuário olhou o **Comparativo Histórico de Horas** do painel e desconfiou:

> "setembro tem 25287 horas em plantões nas escalas ativas é isso mesmo? isso da mais de 1000
> dias, acho que esses cálculos não estão certos."

## O plantão estava certo — e a suspeita ainda assim valeu a pena

Medido em produção, 09/2026:

| conferência | valor |
|---|---|
| plantões lançados | **2.338** |
| horas | **25.287h** (`SUM(horas_computadas)`) |
| servidores distintos | **318** |
| pares servidor+setor | 344 |
| média por servidor | 79,5h no mês (~6,6 plantões de 12h) |
| padrão dominante | 15× `MT` (12h) = 180h — 12x36 clássico |

Os `1.053 dias` vêm de dividir por 24h **como se fosse uma pessoa só**. São 318 pessoas em 30
dias, ~2,6h/dia cada.

Por unidade: **HMI 22.449h** (89%, 250 servidores), SMS 1.294h, HMM 558h, LACEM 276h, o resto
abaixo de 260h. O **+742% contra agosto** é implantação, não trabalho novo — o HMI saiu de 6
escalados em 08/2026 para 390 em 09/2026, e agosto tinha 330 plantões.

Os quatro números do gráfico batiam exatamente com o banco: Regular 163.392 · Plantão 25.287 ·
Sobreaviso 2.616 · Extra 829. **A soma estava certa; o que estava errado era o que se somava, e
quase tudo em volta.**

⚠️ Ao remedir uma hora depois, os totais tinham mudado (19.361 → 19.373 linhas). **É produção
viva** — reconfira sempre, não compare medições de horários diferentes como se fossem a mesma.

## O que estava errado

### 🚨 1. Os relatórios cortavam em 1.000 linhas, em silêncio (armadilha 8)

Quatro telas agregadas não paginavam. Medido em 05/09/2026:

| tela | linhas reais | via | ausente |
|---|---|---|---|
| `/relatorios/rh` | 2.362 escalas | 1.000 | **58%** |
| `/relatorios/plantao-sobreaviso` | 2.362 escalas do ano | 1.000 | **58%** |
| `/relatorios/distribuicao` (09/2026) | 2.338 plantões | 1.000 | **57%** |
| `/relatorios/consolidado` (09/2026) | 1.384 escalas | 1.000 | **28%** |

⚠️ **Em 08/2026 os quatro cabiam em 1000 e pareciam corretos.** Foi a entrada do HMI em 09/2026
que revelou o corte. **Um relatório que hoje cabe não está seguro; ele só ainda não estourou.**

🚨 **O `/relatorios/rh` era o pior: não filtra período nenhum** — lista todas as competências,
uma linha por (servidor, mês) — **e não tinha `ORDER BY`**. O corte de 1000 pegava um recorte
*arbitrário*, sem garantia de ser o mesmo a cada carregamento.

⚠️ **O `.range` que existia em `frequencia` e `plantao-sobreaviso` engana**: era a paginação da
lista de **servidores do seletor**, não a das escalas. Ao auditar paginação, confira **qual**
consulta está paginada.

⚠️ **`plantao-sobreaviso` filtrava o intervalo de meses em JS, depois da consulta** — então o
corte de 1000 acontecia sobre o **ano inteiro** e o período pedido era recortado de uma amostra
arbitrária.

Fonte única desde então: **`src/utils/paginacao.ts`** (`buscarTodasPaginas`).

⚠️ **`.order(...)` não é detalhe.** Sem `ORDER BY` o Postgres não garante ordem entre páginas:
linha pode repetir numa e faltar noutra, e o resultado fica errado **com** paginação.

⚠️ **Falha no meio da paginação não pode ser silenciosa** (armadilha 22). `buscarTodasPaginas`
devolve `completo: false`, e `AvisoDadosIncompletos` põe isso na tela — trocar um número errado
por outro número errado não resolve nada.

### ⚠️ 2. O painel contava o intervalo como jornada no Regular (armadilha 46)

O painel somava `horas_computadas` cru; a grade (`calculateTotals`), o `/relatorios/consolidado`
e a folha (desde 09/2026) descontam o intervalo. Medido, 09/2026:

- painel: **163.392h** · as outras três telas: **126.175h** · **37.217h (22,8%)** de diferença

E o número maior estava justamente na tela usada para decidir. Em 08/2026 a diferença era de
**30.059h**; em 07/2026, 3.666h.

Fonte única desde então: **`src/utils/escala/horasLinha.ts`**, usada pelo painel **e** pelo
consolidado.

| categoria | regra |
|---|---|
| `Regular` | `LEAST(horas_computadas, horas_totais − intervalo/60)` |
| `Plantão` · `Extra` | `horas_computadas` cheio — é trabalho **além** do expediente |
| `Sobreaviso` | **0** na carga; prontidão sai por `horasProntidaoSobreaviso`, com rótulo próprio |

⚠️ **O teto é `LEAST`, nunca substituição.** Turno reduzido (`M4` = 4h) vale as 4h dele.
⚠️ **Jornada que não dá para resolver não vira 8h** — fica sem teto. Inventar um padrão mudaria a
conta de quem tem jornada de 6h ou 12h.
⚠️ **Não replicar `decomporPlantao` (armadilha 16) ali**: as unidades PL existem para as colunas
de pagamento; o total é `horas_computadas` somado, que é o que `fn_carga_mensal_servidor` faz.

ℹ️ A fórmula do consolidado **já estava certa** — o problema era ser a terceira cópia. Duas
cópias certas e uma errada foi exatamente o estado que produziu as 37 mil horas de divergência.

### ⚠️ 3. "Escalas Ativas" misturava duas grandezas na mesma frase

O número grande contava **grades** (pares unidade|setor); o subtítulo contava **linhas** de
`escala_mensal`, que é uma por **servidor**. Em 08/2026 o card dizia `113 Escalas Ativas` e, logo
abaixo, `694 fechadas`. As duas contagens estavam certas e respondiam perguntas diferentes.

Agora as duas são de grades, e **uma grade só conta como fechada quando todas as escalas dela
estão Fechadas** — fechar 3 servidores de 40 não fecha o setor. O número de servidores escalados
entrou ao lado, nomeado.

### ⚠️ 4. "Em serviço hoje" contava linhas de escala, não pessoas

Medido em 05/09/2026: **207** exibido para **188 servidores** (+10%). Quem tem Regular + Plantão
no mesmo dia contava duas vezes. O rótulo diz "em serviço", e isso é gente.

⚠️ A correção **custou o `head: true`**: contar pessoas exige trazer `servidor_id`, e trazer
linhas exige paginar. Contagem exata é barata e imune ao corte de 1000; deduplicação não é.

### ⚠️ 5. As barras do gráfico não eram proporcionais

`Math.max(pctHeight, val > 0 ? 4 : 2)%` mais `min-h-[3px]`: toda barra tinha piso de **4%**. Em
JUL/2026, Sobreaviso (156h) e Regular (13.218h) — **85× maior** — saíam praticamente da mesma
altura, e é assim que se lê o gráfico antes de ler os cartões. Piso agora é de 2px, só para um
valor pequeno mas existente não sumir.

### ℹ️ 6. O gráfico não dizia que é escala prevista

Passou a dizer, e a variação percentual ganhou a ressalva de que inclui setores que **passaram a
lançar escala** — não é só aumento de jornada. Hora realizada é a folha.

### ℹ️ 7. Sobreaviso somado no mesmo eixo das horas trabalhadas

Prontidão não é trabalho presencial: `fn_carga_mensal_servidor` e `calculateTotals` a excluem, e
ela tem ciclo próprio em `logs_sobreaviso`. Fica no gráfico — é informação operacional — com
rótulo `(prontidão)` que a separa.

### ℹ️ 8. Os status fora de `Ativo`/`Inativo` sumiam do card "Servidores"

Medido: 2.065 `Ativo`, 5 `Inativo` e **10 `Afastado`** — e os 10 não apareciam em nenhum dos dois
números. O card passou a derivar o resto de uma contagem **total**, em vez de enumerar status:
status novo no cadastro passa a ser somado sozinho, em vez de sumir em silêncio.

## Fica em aberto

**13 pares (servidor, dia, categoria) com duas escalas em 09/2026**, 126h contadas em dobro —
8 servidores em dois setores. É a armadilha 23, e a trava `trg_escala_diaria_sem_sobreposicao_setor`
(`20260826220000`) já impede casos novos; estes são anteriores a ela ou de slots que a trava
aceita. Não foram tocados: mexer nisso é decisão de escala, não de indicador.

## Portões

```
npx tsc src/utils/escala/horasLinha.ts src/utils/paginacao.ts --outDir scratchpad/_sim --module commonjs --target es2020
node scratchpad/sim_horas_escala.js       # 39 asserções
node scratchpad/val_sim_horas_escala.js   # injeta 5 regressões, exige reprovação nas 5
```

As cinco regressões injetadas: Regular voltando ao vão bruto; Sobreaviso voltando à carga; teto
substituindo em vez de `LEAST`; paginação parando na primeira página; falha de página reportada
como completa. **As cinco reprovam.**

Conferência contra produção: `node scratchpad/an_confere_painel_novo.mjs` executa a consulta e a
conta novas do painel contra o banco real — inclusive o embed aninhado
`escala_mensal!inner(jornadas(...))`, que só se prova executando (armadilha 8b: FK ambígua não
quebra `tsc` nem `build`).

## A lição que vale além destas telas

**A soma estava certa. O que se somava, não.** Quando um número parece grande demais, a primeira
pergunta não é "a conta bate?" — é "**esse número responde a pergunta que o rótulo faz?**". Cinco
dos oito defeitos aqui eram exatamente isso: linhas contadas onde o rótulo dizia pessoas, grades
comparadas com servidores, vão de relógio somado onde se lia jornada, barra com piso onde se lia
proporção.
