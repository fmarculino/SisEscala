# Estudo: onde a IA pode (e onde não deve) ser aplicada no SisEscala

**Data:** 21/08/2026
**Natureza:** levantamento de interesse e requisitos. **Nada aqui é para implementar.**
**Pedido original:** onde a IA contribuiria — busca, dúvidas, achar funções, gerador de escala com
histórico longo, apoio a coordenadores/gerentes/RH, descoberta de situações, otimização de processos.

**Estado:** 📦 **Estudo concluído e ARQUIVADO para implantação futura (decisão do usuário,
21/08/2026).** Nenhuma linha de código, nenhuma migration, nenhuma dependência adicionada — o
`package.json` continua sem qualquer biblioteca de IA. O estudo foi considerado válido e será
**reavaliado em breve**; nada aqui é compromisso de roadmap.

⚠️ **Ao retomar, faça duas coisas antes de decidir qualquer coisa:**

1. **Reconfira os números contra produção.** Todos os dados citados (93 sem biometria, 27 da LACEM,
   ~350 servidores, 33 unidades, 5 seções de `/ajuda`, 187 migrations) vêm da documentação do
   repositório em 21/08/2026. Este projeto já produziu diagnóstico errado por confiar em contagem
   antiga deste próprio arquivo — ver o histórico das armadilhas 10 e da pendência "103 marcações
   de intervalo", que na verdade eram 7.
2. **Reconfira o estado do gerador e da `/ajuda`.** As duas premissas centrais do estudo são
   "o gerador replica em vez de otimizar" (seção 4.D) e "a base de conhecimento não existe"
   (seção 4.B). Se qualquer uma tiver mudado, o ranqueamento inteiro muda junto.

Enquanto estiver arquivado, o valor prático imediato deste documento são as **quatro linhas
vermelhas** da seção 5 — elas valem independentemente de o projeto de IA acontecer ou não.

---

## 0. Resposta curta, antes do estudo

Se você ler só um parágrafo, leia este.

**A coisa de maior valor que você chamou de "IA" nesta lista não é IA no sentido de LLM — é o
Gerador Inteligente virar um otimizador de verdade.** E o problema dele **não é falta de
histórico**: é que ele não otimiza nada. Ele replica o padrão do mês anterior, servidor a
servidor, e ignora o dimensionamento do setor que já está cadastrado em `setores`
(`servidores_manha_min`, `_ideal`, `_max`). Dar a ele 6 meses de histórico em vez de 1 melhora
pouco; dar a ele uma função-objetivo (cobrir o mínimo, distribuir com equidade, respeitar
interjornada) muda o jogo. Isso é **pesquisa operacional**, resolvida desde os anos 90, com
solver determinístico e auditável — não LLM.

**O que a IA generativa faz muito bem aqui é outra coisa: narrar e explicar.** O SisEscala já
tem uma dúzia de detectores de problema em SQL (`fn_varredura_anomalias_presenca`,
`fn_cobertura_ponto_dispositivo`, `fn_conferir_reconciliacao`, `fn_tentativas_negadas_diagnostico`,
`fn_possiveis_duplicidades_servidor`, `fn_documentos_invalidos`). Ninguém olha para eles porque
não têm tela, não têm prioridade e não têm frase em português. Um LLM que leia a saída **já
calculada** desses detectores e escreva "hoje, no CEI, 3 servidores bateram ponto e a batida
morreu órfã; aqui está o link" entrega valor real com risco quase zero — porque não decide nada,
não escreve em lugar nenhum, e o dado que ele narra continua sendo o dado do banco.

**E há uma coisa que eu recomendo não fazer, com convicção: IA nenhuma perto de ponto e folha.**
Não por medo de tecnologia — por Portaria 671/2021, art. 82 e as vedações que este repositório já
documenta em detalhe. Detalho na seção 6.

---

## 1. O que já existe (para não vender de novo o que está pronto)

Antes de propor, o inventário. Quatro coisas nesta lista já são chamadas de "inteligentes" e
convém saber exatamente o que fazem.

| peça | o que realmente faz | é IA? |
|---|---|---|
| **Gerador Inteligente** (`src/utils/intelligentScaleGenerator.ts`, 408 linhas) | lê o mês anterior, detecta `12x36` (razão de intervalos de 2 dias > 0,6) ou `5x2` (trabalha dia útil, folga fim de semana), herda a jornada vigente no último dia do mês anterior, zera dias de afastamento e repete o padrão. **Por servidor, isoladamente.** | não — heurística de padrão, 1 mês de janela |
| **Motor de compliance** (`src/utils/complianceEngine.ts`) | interjornada de 11h, DSR | não — regra determinística |
| **Varredura de anomalias** (`fn_varredura_anomalias_presenca`) | duração < 30 min, entrada tardia em jornada diurna, saída sem entrada | não — SQL com `CASE` |
| **Cobertura de ponto** (`fn_cobertura_ponto_dispositivo`) | classifica cada escalado em `ok`/`sem_vinculo`/`sem_biometria`/`fora_do_relogio` | não — SQL |
| **Página `/ajuda`** | **5 seções** escritas à mão, com uma caixa de busca que filtra texto no cliente | não |
| **Canal WhatsApp** (`avisoPontoCanal.ts` + `/api/avisos-ponto/webhook`) | aviso de ponto sai e a confirmação volta por uma caixa própria do Chatwoot | não — mas é **infraestrutura pronta** para um assistente |

Dependências relevantes hoje: **zero** bibliotecas de IA no `package.json`. Nenhum uso de LLM,
embeddings ou pgvector no repositório. Começaria do zero.

⚠️ **O corpus de documentação de usuário praticamente não existe.** Os 85 arquivos de `docs/`
(976 KB) são documentação **de desenvolvedor** — planos, diários de campo, armadilhas. Servem
para explicar o sistema a mim, não a um coordenador. A `/ajuda` tem 5 seções para um sistema com
~25 telas, 187 migrations e 120+ funções de banco. Isso é o item mais caro de qualquer assistente
de dúvidas, e a seção 4.B explica por que isso muda a conta inteira.

---

## 2. A distinção que decide tudo: quatro tecnologias diferentes estão sendo chamadas de "IA"

A pergunta original mistura quatro famílias. Elas têm custo, risco, prazo e regime jurídico
**completamente diferentes**. Separá-las é a maior parte do trabalho deste estudo.

| # | família | o que é | bom para | péssimo para |
|---|---|---|---|---|
| 1 | **LLM (IA generativa)** | Claude/GPT: lê texto, escreve texto, escolhe ferramenta | explicar, resumir, traduzir jargão, rotear intenção, redigir | contar, calcular, decidir, garantir |
| 2 | **Otimização / pesquisa operacional** | CP-SAT, MILP, busca local | montar escala, alocar cobertura, equidade | responder pergunta em português |
| 3 | **ML preditivo** | regressão, árvores, séries temporais | prever demanda/absenteísmo **com anos de dado limpo** | qualquer coisa hoje (ver 4.E) |
| 4 | **Heurística/regra** | o que o sistema já faz | regra legal, invariante, guard | generalizar sozinha |

**O erro clássico — e o mais caro — é usar a família 1 para fazer o trabalho da 2 ou da 4.**
Pedir a um LLM que "monte a escala do mês" produz uma grade plausível, elegante, com justificativa
convincente e **errada de um jeito que ninguém vê**: um servidor a menos na noite do dia 17, uma
interjornada de 9h, um servidor escalado em férias. Nada disso quebra build, nada disso aparece
no `tsc`, e a mensagem de erro chega no "Salvar Previsão" (armadilha 14) ou não chega nunca.

Nas seções seguintes, cada oportunidade traz a família a que pertence.

---

## 3. Como eu ranqueei

Quatro eixos, e o quarto é o que mais mata ideia boa neste sistema:

1. **Valor** — resolve dor medida ou dor imaginada?
2. **Esforço** — semanas de trabalho, incluindo o que precisa existir antes.
3. **Risco** — o que acontece quando erra? Erra em silêncio?
4. **Reversibilidade** — sistema em produção com dado de ponto de servidor público. Uma sugestão
   errada que vira folha errada é problema jurídico, não bug.

---

## 4. Catálogo de oportunidades

### A. Briefing operacional diário — "o que precisa da sua atenção hoje" ⭐ recomendado

**Família:** 1 (LLM) por cima de 4 (detectores que já existem).

**A dor, medida e documentada neste repositório:** o sistema **já sabe** de dezenas de situações e
não conta para ninguém. O caso mais claro é o da LACEM em 13/08/2026 — **27 dos 39 escalados**
batiam o dedo no relógio, o relógio aceitava, o AFD gravava, e a batida morria órfã por falta de
vínculo. O `CLAUDE.md` registra a frase exata: *"nenhuma das duas pontas reclama"*. Foi preciso
alguém ir a campo e medir. Mesmo padrão nas 93 pessoas sem biometria, nos 41 pares que ficaram
gravados com origem `terminal` onde deveria ter vencido o REP, nas tentativas recusadas.

**O que a IA faria:** uma rotina diária chama os detectores que já existem — nenhum SQL novo,
nenhuma inferência nova —, recebe as linhas, e o LLM produz por unidade/setor um texto curto:
o que mudou desde ontem, o que é urgente, o que é ruído, e o link direto para a tela que resolve.
Um bloco no `/home` e/ou um e-mail.

**Por que o LLM ganha aqui de uma tela comum:** uma tabela com 27 linhas de `sem_vinculo` já
existe e ninguém abre. O ganho não é detectar — é **priorizar, agrupar e escrever em português o
que fazer a seguir**, distinguindo "isso é normal" de "isso é uma pessoa sem ponto há 6 dias".
É exatamente o trabalho em que LLM é bom e barato.

| prós | contras |
|---|---|
| não decide nada, não escreve nada — só lê saída já calculada e narra | pode errar a ênfase e criar alarme falso |
| aproveita 100% do que já foi construído em SQL | precisa de curadoria inicial de "o que é urgente" |
| reversível: desligar é apagar um bloco de tela | mais um canal a ignorar se virar spam diário |
| erro é visível (o link leva à tela com o dado real) | custo recorrente, ainda que pequeno (~US$ 40/mês, seção 7) |

**Risco:** baixo. **Esforço:** 2–3 semanas. **Veredito: melhor primeiro passo do projeto inteiro.**

---

### B. Assistente de dúvidas ancorado na documentação (RAG) — recomendado **com uma ressalva grande**

**Família:** 1.

**A dor:** "como uso o SisEscala", "onde fica X", "por que não consigo validar este dia". Hoje a
resposta mora em 5 seções de `/ajuda` ou na cabeça de duas pessoas.

⚠️ **A ressalva que muda a economia da ideia:** a pesquisa de 2026 sobre assistentes corporativos
é consistente em um ponto — **a taxa de resolução depende muito mais da qualidade da base de
conhecimento do que do modelo**. Arrumar chunking e adicionar reranker move 15–20 pontos
percentuais; trocar de LLM move 2–3. A mediana de resolução em primeiro nível está em ~41%, com
o quartil superior em ~59%, e os 70–87% só aparecem depois de investimento pesado em base.

**Traduzindo para o SisEscala: a base não existe.** O caro não é o assistente — é escrever a
documentação de usuário que hoje tem 5 seções. E aqui está a parte incômoda e honesta:
**escrever essa documentação já entrega metade do valor sem nenhuma IA.** Se o projeto parar
depois de escrever, o dinheiro não foi perdido.

Recomendação prática: **inverter a ordem**. Primeiro a base (30–50 artigos curtos, um por tela e
por fluxo, com as regras que hoje só existem no `CLAUDE.md` traduzidas para linguagem de
coordenador). Só então o assistente por cima, **sempre com citação** — cada resposta aponta o
artigo, e o usuário pode conferir.

| prós | contras |
|---|---|
| reduz dependência de duas pessoas para tirar dúvida | **exige escrever a base primeiro** — é o custo real |
| a base sozinha já vale, mesmo sem IA | documentação desatualizada vira resposta errada com aparência confiável |
| citação obrigatória torna a resposta conferível | responsabilidade institucional pelo que o bot diz (seção 6) |
| escopo fechado e não-pessoal (não fala de servidor específico) | manutenção perpétua: cada release muda a base |

**Risco:** médio-baixo, **se** o escopo for "como o sistema funciona" e nunca "qual o seu ponto do
dia 12". **Esforço:** 4–6 semanas (a maior parte redigindo). **Veredito: sim, na ordem certa.**

---

### C. Busca por linguagem natural que **navega**, não que consulta o banco ⭐ recomendado

**Família:** 1 usada como roteador de intenção.

**A dor real:** "achar funções dentro do SisEscala", que foi exatamente o que você citou. O sistema
tem ~25 telas e muita função escondida atrás de aba (Cobertura da Escala, Higiene do Relógio,
Biometria Pendente, Importar por Pendrive, Terminais Locais — tudo dentro de `/marcacoes`).

**O que fazer:** uma barra de busca única onde se digita *"quem não está batendo ponto no CEI"* e
o sistema **abre a tela certa com o filtro certo** — `/marcacoes` → aba Cobertura da Escala →
unidade CEI. O LLM não responde a pergunta; ele escolhe o destino e os parâmetros.

🚨 **O que NÃO fazer, e isto é a recomendação técnica mais firme deste documento: não implementar
text-to-SQL aberto.** Os benchmarks de 2026 são inequívocos — em esquema real de empresa (Spider
2.0), a acurácia despenca de ~86% (esquema de brinquedo) para **6% a 21%**. E há um agravante
específico daqui: **as migrations não são o schema completo** (armadilha 2) — as tabelas base
`escala_diaria`, `jornadas`, `dicionario_turnos` foram criadas fora do versionamento, e
`src/types/database.ts` está incompleto. Um gerador de SQL trabalharia com um mapa errado do
território, num banco onde `setores` **não tem coluna `nome`** e `configuracoes_globais` **não tem
coluna `timezone`** — dois enganos que já causaram erro em produção com um humano no comando.

**A alternativa certa é *tool use* sobre as RPCs que já existem.** O sistema tem 120+ funções
`fn_*`, muitas já sendo exatamente "a consulta certa, com o escopo certo": `fn_marcacoes_mes`,
`fn_cobertura_ponto_resumo`, `fn_painel_sobreaviso_dia`, `fn_pendencias_biometria`,
`fn_trilha_auditoria`. Expor **um subconjunto pequeno e explicitamente escolhido** delas como
ferramentas dá ao modelo um cardápio fechado, parametrizado e auditável, em vez de acesso livre
ao banco. O modelo escolhe *qual* função e *quais* parâmetros; a função continua sendo o código
revisado que já está em produção.

| prós | contras |
|---|---|
| resolve "achar função" e "achar dado" sem gerar SQL | precisa curar o cardápio de ferramentas à mão |
| cada ferramenta é código já revisado e já em produção | o modelo pode escolher a ferramenta errada (erro visível, não silencioso) |
| escopo/RLS continuam valendo, porque é a mesma RPC | não responde perguntas fora do cardápio |
| erro típico é "abriu a tela errada" — barato | |

**Risco:** baixo. **Esforço:** 3–4 semanas. **Veredito: sim.**

⚠️ **Armadilha de arquitetura que precisa entrar no plano desde o primeiro dia:** RPCs com guard de
escopo **não funcionam com `service_role`** — `get_my_role()` devolve `NULL` e
`fn_unidade_no_escopo` devolve `false`. Ou seja: o assistente **tem que executar com a sessão do
usuário**, nunca com chave de serviço. Isso é uma vantagem de segurança, não um obstáculo:
significa que o assistente herda a RLS e **não consegue, por construção, mostrar dado de unidade
que o usuário não pode ver**. Se alguém "simplificar" usando `service_role`, essa fronteira cai
inteira e em silêncio.

---

### D. O Gerador Inteligente ficar realmente inteligente ⭐⭐ maior valor — e não é LLM

**Família:** 2 (otimização). Esta é a resposta técnica à sua pergunta sobre histórico longo.

**Primeiro, o diagnóstico honesto do que existe.** O gerador atual:

- olha **1 mês**, e só a categoria `Regular`;
- detecta 2 padrões (`12x36`, `5x2`) por contagem simples; qualquer outra coisa vira `Desconhecido`;
- decide **servidor a servidor, isoladamente** — nunca olha o setor como um todo;
- **não usa o dimensionamento que já está cadastrado** (`servidores_manha_min/_ideal/_max` em
  `setores`), então não sabe se o dia 14 ficou com 2 pessoas onde o mínimo é 4;
- não distribui carga com equidade, não valida interjornada na geração, não sabe de plantão/extra;
- escreve direto no `gridData` **sem passar por `handleCellChange`** — é um dos três caminhos da
  armadilha 14, e a recusa do banco só aparece no "Salvar Previsão", abortando o mês inteiro.

**Segundo: histórico longo é possível, mas com uma distinção que importa.** Há dois históricos
neste sistema e eles não têm a mesma qualidade:

| histórico | serve para o gerador? |
|---|---|
| **previsão** (`escala_diaria`, o que foi escalado) | **sim** — é o plano, e competências fechadas estão congeladas e estáveis |
| **realizado** (ponto: `presenca_*`) | **não, ainda** — `presenca_*_origem` só existe desde `20260808020000`, e o `CLAUDE.md` é explícito: **junho e julho/2026 não são auditáveis por horário** |

Então: ampliar a janela de **previsão** para 3–6 meses é legítimo e melhora a detecção de padrão
(um mês atípico por férias deixa de contaminar). Ampliar para o **realizado** não é — não há série
histórica confiável ainda.

**Terceiro, e é o ponto central: mais histórico não é o gargalo.** O gargalo é que o gerador
**replica** em vez de **otimizar**. O que falta é uma função-objetivo:

- **restrições rígidas** — afastamento (a fonte única `encontrarAfastamentoBloqueante` já existe),
  interjornada de 11h (o `complianceEngine` já existe), DSR, um turno regular por dia, competência
  fechada;
- **objetivos** — cobrir o mínimo de cada turno, aproximar do ideal, equidade de carga e de fins de
  semana, respeitar preferência, manter continuidade do ciclo.

Isso é o *nurse rostering problem*, um dos problemas mais estudados de pesquisa operacional. O
estado da arte é **CP-SAT** (OR-Tools), com estudo recente medindo **~224x mais rápido que
algoritmo genético** no mesmo problema. Sobre a stack: OR-Tools tem build **WebAssembly** que roda
em Node — ou se isola num microserviço Python. Há também o caminho intermediário, que eu
recomendaria testar primeiro: **guloso pontuado + reparo local**, escrito em TS, exatamente o que
o estudo de 26/06/2026 já havia proposto como "Opção B vencedora" e que nunca foi implementado
(o que existe hoje é menos que aquilo — não tem score, não tem cobertura, não tem equidade).

**Onde o LLM entra — e só aqui:** não em gerar a escala. Em **explicar** a escala gerada
("o dia 14 ficou com 3 de 4 porque Fulana está de férias e Beltrano bate o limite semanal") e em
**receber ajuste em linguagem natural** ("tira a Maria dos fins de semana") que vira mudança de
peso/restrição no solver, com o solver decidindo. O modelo conversa; o solver garante.

| prós | contras |
|---|---|
| ataca a dor mais cara e mais repetitiva do coordenador | é o item de maior esforço do catálogo |
| determinístico, explicável, reproduzível — auditável | exige modelar bem restrição e peso; modelo mal calibrado gera escala "certa e inaceitável" |
| aproveita dimensionamento e compliance já cadastrados | pode expor que o dimensionamento cadastrado está errado/desatualizado (é um bem, mas dá trabalho) |
| não tem risco jurídico de IA — é cálculo, com humano aprovando | OR-Tools em WASM/microserviço é peça nova de infra no Coolify |

⚠️ **Pré-requisito inegociável:** validar **antes** de salvar. O gerador novo, como o atual e como
o Aplicar Template, escreve no estado da grade; a armadilha 14 documenta que uma linha inválida
aborta o upsert do mês inteiro com mensagem crua do Postgres. Um gerador que produz 900 células
precisa validar as 900 na geração, não no salvamento.

**Risco:** médio (é mudança grande em tela crítica), mas **sem risco jurídico** — nada aqui toca
em ponto. **Esforço:** 6–10 semanas. **Veredito: é o maior valor da lista. Só não é o primeiro
passo porque é o mais caro.**

---

### E. Previsão de absenteísmo / demanda por ML — ❌ prematuro, e há um problema jurídico junto

**Família:** 3.

A literatura existe e é boa: redes neurais prevendo absenteísmo de enfermagem com ~82% de
acurácia, previsão de carga de trabalho 72h à frente, modelos de *no-show* com AUC ~0,87.

**Por que ainda não aqui — duas razões independentes, e cada uma sozinha basta:**

1. **Dado.** São ~350 servidores e a série de ponto confiável começa em **agosto de 2026**. Não é
   pouco dado por acaso — é pouco dado por construção: `presenca_*_origem` é recente, junho e
   julho não são auditáveis, e a virada do REP mudou a natureza do registro no meio da série.
   Treinar sobre isso produz um modelo que aprende o histórico da *implantação*, não do
   comportamento das pessoas.
2. **Jurídico.** Prever que um servidor específico vai faltar é **perfilamento de pessoa
   natural**. Cai no art. 20 da LGPD (direito de revisão de decisão automatizada), pede RIPD, e
   entra no radar do marco de IA em tramitação. E o risco de dano é assimétrico: um falso positivo
   estigmatiza uma pessoa dentro do sistema que também calcula a folha dela.

**Veredito: não fazer.** Reavaliar quando houver 12–18 meses de série limpa — e mesmo então,
prever **demanda agregada por setor** (quantas pessoas o turno da noite precisa em dezembro),
nunca **comportamento individual**. A versão agregada não perfila ninguém e é a que tem valor
gerencial de verdade.

---

### F. Explicar decisões do sistema em português ⭐ recomendado, e subestimado

**Família:** 1 sobre dado já calculado.

**A dor:** o SisEscala toma decisões que são **corretas e incompreensíveis**. Exemplos reais deste
repositório: a batida das 21:20 do dia 18 virando entrada do dia 19 e empurrando a batida das
08:23 para "saída para o intervalo" (o caso do coordenador da TI); a batida de transição às 13:07
entre um Regular M e um Plantão T; a marcação que perdeu por precedência e ficou
`substituida_por_precedencia`; a jornada trocada no meio do mês que reescreveu o julgamento dos
dias 1 a 11. Cada um desses episódios consumiu **um dia de investigação de desenvolvedor**.

**O que fazer:** um botão "por que este horário?" que pega a projeção **já calculada**
(`fn_projecao_marcacoes_dia`, `fn_blocos_previstos_dia`, a alocação com seus slots e o desempate)
e pede ao LLM que traduza aquilo para 4 linhas de português. O modelo **não recalcula nada** —
ele lê o resultado e a estrutura que produziu o resultado.

| prós | contras |
|---|---|
| transforma o suporte de "abre o SQL" em "lê a explicação" | explicação convincente de um cálculo errado é pior que nenhuma explicação |
| não decide, não escreve, não recalcula | precisa mostrar sempre o dado bruto ao lado, nunca só a narrativa |
| valor didático alto: coordenador aprende a regra | exige prompt cuidadoso para não "inventar" a regra que faltou |
| custo por uso baixíssimo (sob demanda) | |

**Risco:** baixo-médio — a mitigação é obrigatória e simples: **a narrativa nunca aparece
sozinha**, sempre ao lado dos timestamps e da origem. **Esforço:** 2–3 semanas.
**Veredito: sim — provavelmente o melhor custo-benefício depois do briefing.**

---

### G. Triagem de justificativas e solicitações de ajuste — sim, em modo sugestão

**Família:** 1.

`fn_solicitar_ajuste_ponto` (portal do servidor), `justificativas_eventos` e as pendências de RH
produzem texto livre que alguém lê e classifica. O LLM pode **pré-classificar** (categoria,
urgência, se falta anexo, se o pedido é coerente com o que a escala diz daquele dia) e **redigir
um rascunho** de resposta.

⚠️ **Fronteira firme:** sugestão, sempre com o texto original visível, e **o coordenador decide**.
Aprovação automática de ajuste de ponto por IA é exatamente a vedação 4 da Portaria 671 (dispositivo
que permite alterar o registro) somada ao art. 20 da LGPD. Sugerir é tratamento; decidir é outra
coisa.

**Risco:** médio (é texto de pessoa sobre a jornada dela). **Esforço:** 2–3 semanas.
**Veredito: sim, depois de A/C/F, e com rótulo visível de "sugestão automática".**

---

### H. Assistente no WhatsApp para o servidor — ❌ não agora

**Família:** 1.

A infraestrutura está pronta (Chatwoot com caixa dedicada, webhook de entrada, Captain como agente
nativo self-hosted). A tentação é grande e o valor incremental é pequeno; o risco não é.

**Por que não:**

1. **Responsabilidade institucional pelo que o bot diz.** Em *Moffatt v. Air Canada* (2024) o
   tribunal recusou o argumento de que o chatbot seria "entidade separada responsável pelos
   próprios atos" e responsabilizou a empresa pela informação errada. Um bot da Secretaria
   Municipal de Saúde dizendo a um servidor "seu ponto do dia 12 está certo" ou "você pode faltar
   amanhã" é declaração da administração pública.
2. **Canal não autenticado e assíncrono.** O portal do servidor autentica por matrícula + PIN. O
   WhatsApp identifica por número de telefone — número trocado, aparelho emprestado, e a
   conversa expõe dado funcional de terceiro. A decisão de 08/08/2026 de **descartar PIN no
   relógio** partiu do mesmo raciocínio: equipamento/canal não supervisionado não sustenta
   identidade.
3. **O caso de uso mais pedido é justamente o proibido** — "quantas horas eu fiz", "corrige meu
   ponto".

**Veredito: não.** Se um dia sim, comece por **notificação estruturada** (que já existe) e no
máximo consulta **somente-leitura da própria escala**, com autenticação real, nunca conversa livre.

---

### I. Leitura automática de atestados e documentos (OCR/visão) — boa ideia, sem base para ficar de pé

**Família:** 1 (multimodal).

Extrair de um atestado a data de início, os dias, o CID e o profissional, e pré-preencher o
afastamento, é um ganho claro para o RH.

⚠️ **Bloqueio de infraestrutura:** o sistema **não tem armazenamento de anexo nenhum**. Não há uma
única chamada a `storage.from(` em `src/`. Afastamentos, férias e justificativas são todos texto e
data — o único PDF do sistema é o de justificativa preparado para assinatura no gov.br. Ou seja: o
pré-requisito não é IA, é upload, bucket, RLS de arquivo, retenção e política de exclusão.

⚠️ E CID é **dado pessoal sensível** (saúde, art. 5º II da LGPD). Mandá-lo a uma API externa muda o
patamar de exigência de todo o projeto — passa a exigir RIPD, base legal específica e, na prática,
decisão do jurídico da Secretaria.

**Veredito: adiar.** Reabrir se e quando existir gestão de anexos. Não é o próximo passo.

---

### J. Redação assistida para RH e coordenação — sim, trivial, valor modesto

Comunicados, e-mails de cobrança, texto de portaria, resumo de relatório para o gestor. Risco quase
nulo (humano lê e envia), valor modesto, esforço mínimo. Cabe como efeito colateral do assistente
da letra B, não como projeto próprio.

---

## 5. Quadro consolidado

| # | oportunidade | família | valor | esforço | risco | veredito |
|---|---|---|---|---|---|---|
| **A** | Briefing operacional diário | LLM + SQL existente | alto | baixo | baixo | ⭐ **primeiro** |
| **F** | Explicar decisões em português | LLM sobre cálculo pronto | alto | baixo | baixo | ⭐ **segundo** |
| **C** | Busca que navega (tool use, sem text-to-SQL) | LLM roteador | alto | médio | baixo | ⭐ **terceiro** |
| **D** | Gerador de escala com otimização | **otimização** | **o maior** | alto | médio | ⭐⭐ **o projeto de verdade** |
| **B** | Assistente de dúvidas (RAG) | LLM + base | médio-alto | alto (redação) | médio-baixo | sim, **base primeiro** |
| **G** | Triagem de justificativas | LLM | médio | médio | médio | sim, depois |
| **J** | Redação assistida | LLM | baixo-médio | mínimo | baixo | de brinde com B |
| **I** | OCR de atestados | LLM multimodal | médio | alto (infra) | alto (dado sensível) | adiar |
| **E** | Previsão de absenteísmo individual | ML | baixo hoje | alto | **alto (LGPD)** | ❌ não |
| **H** | Bot de WhatsApp para servidor | LLM | baixo | médio | **alto** | ❌ não |
| — | **Text-to-SQL aberto** | LLM | — | — | **alto** | ❌ **nunca** |
| — | **IA decidindo ponto/folha** | qualquer | — | — | **inaceitável** | ❌ **nunca** |

---

## 6. O cerco jurídico — leia antes de aprovar qualquer coisa

Este sistema não é um SaaS. É registro de jornada de servidor público, com REP-C certificado e
AFD assinado, e o SisEscala como PTRP da Portaria 671/2021.

### 6.1 Portaria 671/2021 — o que já é vedado, com ou sem IA

O `CLAUDE.md` já registra as quatro vedações e as três regras que saíram delas na v1.22.0. Duas
merecem destaque no contexto de IA:

> **vedação 2 — marcação automática usando horários predeterminados ou contratuais.**

Um LLM que "preenche o horário que provavelmente foi" é a vedação 2 na forma mais pura possível —
com o agravante de ser mais convincente que o horário sintético que já foi removido do sistema.

> **vedação 4 — qualquer dispositivo que permita alterar o dado registrado pelo empregado.**

O princípio que o próprio repositório já formulou, e que resolve todo caso duvidoso:

> **o sistema só preenche onde o servidor não tem como registrar. Onde ele tem meio, preencher é
> fabricar.**

**Aplicado à IA:** IA pode **ler, ordenar, explicar e sugerir a um humano**. Não pode preencher,
aprovar nem decidir. As regras "nunca fabricar horário" e "nunca descartar batida" valem para o
código de IA exatamente como valem para `fn_confirmar_presenca`.

### 6.2 LGPD — art. 20 e o que ele exige na prática

O art. 20 dá ao titular direito de revisão de decisões tomadas unicamente com base em tratamento
automatizado que afetem seus interesses, incluindo perfil profissional. Tratamento com impacto
significativo deve ser documentado, idealmente com **RIPD**, cobrindo dados usados, lógica do
tratamento, risco de discriminação e mitigação.

Traduzido para decisões de arquitetura, três regras:

1. **Humano no circuito, sempre** — nada de IA gravando em `escala_diaria`, `folha_ponto` ou
   `marcacoes_ponto`. Nem uma vez, nem "só para o caso fácil".
2. **Minimização** — o modelo não precisa de CPF, PIS, matrícula nem telefone para explicar uma
   escala. Pseudonimizar antes de sair do banco. Nunca mandar dado de saúde.
3. **Rastreabilidade** — toda saída de IA rotulada como tal, com modelo, versão de prompt e
   entrada registrados na trilha de auditoria (`fn_trilha_auditoria` já existe). Sem isso não há
   como responder a um pedido de revisão.

### 6.3 Marco legal de IA (PL 2338/2023) — estado em 2026

Aprovado no Senado em dezembro de 2024, na Câmara desde março de 2025, em comissão especial, com
votação prevista para 2026 e provável retorno ao Senado. **Ainda não é lei**, mas a direção está
dada: sistemas de risco elevado — e RH/gestão de pessoal aparece nessa categoria nas versões em
discussão — exigirão avaliação de impacto, transparência e supervisão humana. A ANPD já opera
sandbox regulatório e se considera competente sempre que houver dado pessoal.

**Consequência de projeto:** construir agora com rótulo, log e humano no circuito não é zelo
excessivo — é evitar refazer depois.

### 6.4 Responsabilidade pelo que o assistente diz

*Moffatt v. Air Canada* (2024, BCCRT): a empresa respondeu pela informação errada dada pelo
chatbot; o tribunal chamou de "notável" o argumento de que o bot seria entidade separada. Análises
de 2026 confirmam a linha — quem publica o bot responde pelo que ele diz.

Para um órgão público isso é mais forte, não menos. Mitigações: escopo fechado, citação obrigatória
da fonte, recusa explícita fora do escopo ("não sei, procure a coordenação"), e **nenhuma afirmação
sobre direito, pagamento ou situação funcional de pessoa**.

---

## 7. Custo — e por que ele não é o obstáculo

Preços de tabela da API Anthropic (por milhão de tokens), agosto/2026:

| modelo | contexto | entrada | saída | papel sugerido |
|---|---|---|---|---|
| Claude Haiku 4.5 | 200K | US$ 1 | US$ 5 | classificação, triagem, roteamento |
| Claude Sonnet 5 | 1M | US$ 3 (intro US$ 2 até 31/08/2026) | US$ 15 (intro US$ 10) | briefing, explicação, assistente |
| Claude Opus 5 | 1M | US$ 5 | US$ 25 | só onde a qualidade decide |

Com **cache de prompt** (leitura de cache ~0,1x do preço de entrada), o prefixo estável — instruções
+ base de conhecimento + definição de ferramentas — sai quase de graça a partir da segunda chamada.

Estimativa de ordem de grandeza, com premissas explícitas:

| cenário | premissa | modelo | custo/mês |
|---|---|---|---|
| Assistente de dúvidas | 40 usuários de retaguarda, ~440 perguntas/mês, 10K entrada (8K em cache) + 700 saída | Sonnet 5 | **~US$ 8** |
| idem | mesmo volume | Haiku 4.5 | **~US$ 3** |
| Briefing diário | 33 unidades × 22 dias, 20K entrada (10K em cache) + 1,2K saída | Sonnet 5 | **~US$ 37** |
| Explicação sob demanda | 200 usos/mês | Sonnet 5 | **~US$ 4** |
| **Total** | | | **~US$ 50/mês** (≈ R$ 275 a R$ 5,50/US$) |

⚠️ **Números indicativos**, sensíveis a volume real e à cotação; o volume de usuários de retaguarda
precisa ser confirmado contra produção (não consultei o banco neste estudo).

**A leitura correta desta tabela:** o custo de inferência é irrelevante perto do custo de
**engenharia e de curadoria**. Semanas de desenvolvimento e a redação da base de conhecimento
dominam a conta por ordens de grandeza. **Quem decidir por custo de API está olhando para a
variável errada.**

---

## 8. Se for adiante — o desenho que eu defenderia

### 8.1 Princípios (nesta ordem)

1. **A IA nunca escreve em tabela de domínio.** Sem exceção. `escala_diaria`, `folha_ponto`,
   `marcacoes_ponto`, `escala_mensal` são intocáveis por qualquer caminho de IA.
2. **A IA roda com a sessão do usuário, nunca com `service_role`.** A RLS é a fronteira de
   segurança, e ela só existe se o JWT for o do usuário.
3. **Ferramentas curadas, não SQL livre.** Cardápio explícito de RPCs já revisadas.
4. **Toda saída rotulada e logada.** Modelo, versão de prompt, entrada, saída, trilha de auditoria.
5. **Interruptor geral por configuração.** `configuracoes_globais` já é o lugar. Desligar tem que
   ser um clique, e o sistema tem que continuar 100% funcional desligado.
6. **Degradação silenciosa é proibida.** Se a IA falhar, a tela mostra o dado bruto e diz que a
   explicação não está disponível — nunca some sem avisar. Este sistema já foi mordido três vezes
   por falha silenciosa (bundle velho do terminal, batida órfã, anti-replay).

### 8.2 Esboço de arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│ Next.js (Coolify) — Server Action / Route Handler            │
│  · sessão Supabase do usuário (RLS ativa)                    │
│  · pseudonimização antes de sair do banco                    │
│  · rótulo + log em auditoria (sempre)                        │
└───────────────┬──────────────────────────────────────────────┘
                │ tool use (cardápio fechado)
       ┌────────┴─────────┐
       ▼                  ▼
┌──────────────┐   ┌─────────────────────────────┐
│ RPCs curadas │   │ Base de conhecimento (RAG)  │
│ fn_cobertura │   │ artigos de uso + citação    │
│ fn_marcacoes │   │ obrigatória da fonte        │
│ fn_trilha... │   └─────────────────────────────┘
└──────────────┘
                        (o solver de escala é peça
                         SEPARADA — não passa por aqui)
```

`inference_geo` permite fixar a geografia de inferência — vale avaliar junto ao jurídico, assim
como retenção zero e ausência de treinamento sobre os dados, que precisam ser confirmados
**contratualmente**, não presumidos.

### 8.3 Faseamento sugerido

| fase | entrega | pré-requisito | semanas |
|---|---|---|---|
| **0** | decisão jurídica: base legal, RIPD, o que pode sair do banco | — | 2–4 (calendário, não esforço) |
| **1** | Briefing diário (A) | fase 0 | 2–3 |
| **2** | Explicação de decisões (F) | fase 1 | 2–3 |
| **3** | Base de conhecimento escrita — **entrega valor sozinha** | — (paralelizável) | 4–6 |
| **4** | Busca que navega (C) + assistente de dúvidas (B) | fase 3 | 4–6 |
| **5** | Gerador com otimização (D) — **projeto próprio, sem LLM** | independente | 6–10 |
| **6** | Triagem de justificativas (G) | fase 4 | 2–3 |

A fase 5 não depende de nenhuma das outras e pode correr em paralelo com todas — é outro tipo de
trabalho, feito por outro tipo de raciocínio.

---

## 9. Prós e contras do projeto como um todo

### A favor

- **Há dor real e medida**, não hipotética: 27 pessoas sem ponto na LACEM, 93 sem biometria, casos
  de alocação que custaram um dia de investigação cada.
- **A base de dados é boa.** Origem por marcação, precedência explícita, INSERT-only, competência
  congelada, trilha de auditoria. Muito sistema que quer IA não tem metade disso.
- **Custo de inferência desprezível** frente a qualquer outra linha do orçamento.
- **Dá para começar pequeno e reversível** — briefing e explicação não tocam em nada.
- **O item de maior valor (gerador) não tem risco jurídico**, porque não é IA generativa.

### Contra

- **O sistema ainda está sendo construído.** Fase 5 do REP acabou de ficar inerte, a virada do CEI
  é de ontem, o vínculo duplo está sem solução escolhida, o pendrive nunca foi testado ponta a
  ponta. Cada semana em IA é uma semana fora disso.
- **Uma pessoa mantendo tudo.** Camada de IA é manutenção perpétua: base de conhecimento
  desatualizada vira resposta errada, e resposta errada com aparência confiável é pior que
  ausência de resposta.
- **Erro de LLM é silencioso** — a mesma classe de falha que já mordeu este projeto várias vezes
  (`CREATE OR REPLACE` apagando lógica, terminal com bundle velho, batida órfã). O modo de falha
  favorito deste sistema é exatamente aquele em que LLM é pior.
- **Regime jurídico exigente e em movimento**, num sistema que produz prova em processo trabalhista.
- **Risco de expectativa.** "O SisEscala tem IA" cria demanda por exatamente as funções que **não**
  podem existir: "corrige meu ponto", "preenche o que faltou", "monta e salva a escala".

---

## 10. Minha opinião sincera

**Sim, vale a pena — mas quase nada do valor está onde a palavra "IA" costuma apontar.**

Três convicções, em ordem de força:

**Primeira: o gerador de escala é a maior oportunidade do sistema, e resolvê-lo bem significa
não usar IA generativa.** Você intuiu certo que ele é raso — mas a causa não é a janela de 1 mês,
é que ele **não otimiza nada**. Ele copia. Colocar 6 meses de histórico num algoritmo que copia
produz uma cópia mais bem informada, não uma escala melhor. O que muda o resultado é dar a ele um
objetivo — cobertura mínima, equidade, interjornada — e um solver. Isso é problema resolvido há
décadas, é determinístico, é explicável linha a linha para um auditor, e sobrevive a qualquer
regulação futura de IA porque não é IA. Se eu pudesse escolher **um** projeto desta lista, seria
esse. E ele é o único que, feito direito, o coordenador sente na primeira semana.

**Segunda: o melhor uso de LLM aqui não é responder perguntas — é quebrar o silêncio do sistema.**
O padrão de falha mais caro e mais repetido do SisEscala, documentado à exaustão no próprio
`CLAUDE.md`, é a **falha silenciosa dos dois lados**: a pessoa bate o dedo, o relógio aceita, o AFD
grava, e a batida morre órfã sem ninguém reclamar. O sistema já detecta quase tudo isso em SQL.
O que falta é alguém dizer em voz alta, todo dia, para a pessoa certa, em português, o que está
acontecendo. Um LLM faz isso muito bem, por dezenas de dólares por mês, sem decidir nada e sem
escrever nada. **Comece por aí** — é a fase 1 porque é barata, reversível e ataca a patologia
estrutural do sistema, não um incômodo de interface.

**Terceira: o assistente de dúvidas é a ideia mais popular e a que eu adiaria mais.** Não porque
seja ruim — porque a evidência de 2026 é clara em que o resultado depende da base de conhecimento,
não do modelo, e **a base não existe**: 5 seções de ajuda para ~25 telas, e 976 KB de documentação
escrita para desenvolvedor. Se você fizer só o assistente, ele vai responder mal e queimar a
credibilidade da ideia inteira dentro da Secretaria. Se você escrever a base primeiro, já ganha
metade do valor sem IA nenhuma — e aí o assistente vira um multiplicador em cima de algo sólido.
**Inverter essa ordem é o erro mais provável deste projeto.**

E uma ressalva que não é técnica: **o momento.** Fase 5 do REP inerte, virada do CEI de ontem,
vínculo duplo indefinido, pendrive nunca testado contra hardware, 93 servidores sem biometria.
Nada disso se resolve com IA — resolve-se com campo, dedo no sensor e migration aplicada. Se a IA
entrar agora como frente principal, ela compete com o que faz a folha de agosto fechar. Como frente
**secundária**, começando pelo briefing (2–3 semanas, reversível), ela **ajuda** exatamente esse
trabalho, porque a primeira coisa que o briefing faria é gritar sobre as 93 pessoas sem biometria
todos os dias até alguém resolver.

**Recomendação final:** fase 0 (jurídico) + fase 1 (briefing) agora, porque é barato e ataca a
patologia central. Fase 3 (escrever a base) em paralelo, por ser útil de qualquer jeito. O gerador
com solver como o próximo projeto grande, **quando o REP estabilizar**. Assistente de dúvidas
depois da base. E as linhas vermelhas — ponto, folha, WhatsApp livre, text-to-SQL, previsão
individual — escritas em algum lugar onde não se possa alegar esquecimento.

---

## Fontes consultadas

**Otimização de escalas**
- [Nurse rostering in OR-Tools CP-SAT solver — Solver Max](https://www.solvermax.com/resources/models/staff-scheduling/nurse-rostering-in-or-tools-cp-sat-solver)
- [Application of Constraint Programming with Satisfiability in Nurse Scheduling — MDPI](https://www.mdpi.com/2673-4591/134/1/32)
- [Nurse scheduling problem — Wikipedia](https://en.wikipedia.org/wiki/Nurse_scheduling_problem)
- [A Nurse Staffing and Scheduling Problem with Bounded Flexibility and Demand Uncertainty — arXiv](https://arxiv.org/html/2505.22124v2)
- [or-tools-wasm — OR-Tools em WebAssembly](https://github.com/Axelwickm/or-tools-wasm)

**Text-to-SQL e seus limites**
- [Text-to-SQL Benchmarks are Broken: An In-Depth Analysis of Annotation Errors — VLDB/CIDR 2026](https://www.vldb.org/cidrdb/2026/text-to-sql-benchmarks-are-broken-an-in-depth-analysis-of-annotation-errors.html)
- [The Text-to-SQL Performance Cliff (2026)](https://medium.com/@visrow/the-text-to-sql-performance-cliff-2026-why-natural-language-to-sql-breaks-a7281a23dbea)
- [Spider 2.0-AIFunc: Extending Real-World Text-to-SQL — arXiv](https://arxiv.org/pdf/2607.06229)

**Assistentes ancorados (RAG)**
- [Deflection rate in AI support (2026) — eesel](https://www.eesel.ai/blog/deflection-rate-what-is-it-and-how-to-improve-it)
- [7 RAG Failure Modes Crippling Enterprise Deployments in 2026](https://ragaboutit.com/7-rag-failure-modes-crippling-enterprise-deployments-in-2026/)
- [Enterprise RAG: Use Cases, Common Pitfalls & Effective Solutions](https://wearefram.com/blog/enterprise-rag/)
- [Captain — AI Agent do Chatwoot](https://www.chatwoot.com/captain)

**Responsabilidade por chatbot**
- [Moffatt v. Air Canada: A Misrepresentation by an AI Chatbot — McCarthy Tétrault](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot)
- [BC Tribunal Confirms Companies Remain Liable for Information Provided by AI Chatbot — ABA](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-february/bc-tribunal-confirms-companies-remain-liable-information-provided-ai-chatbot/)
- [Courts to Companies: You Own What Your Chatbot Says — PYMNTS (2026)](https://www.pymnts.com/news/artificial-intelligence/chatbot-tracker/2026/courts-tell-companies-they-own-what-their-chatbot-says)

**Regulação brasileira**
- [ANPD e Regulação de IA no Brasil: Guia 2026-2027](https://confidata.com.br/blog/anpd-regulacao-ia-brasil-2026-2027)
- [Marco Legal da IA terá votação final em 2026](https://blog.cbrdoc.com.br/marco-legal-da-ia-tera-votacao-final-em-2026/)
- [Decisões Automatizadas na LGPD: Art. 20 e Direito à Revisão](https://confidata.com.br/blog/lgpd-comentada-13-prazos-decisoes-automatizadas)
- [Artigo 20 da LGPD: A Revisão de Decisões Automatizadas Funciona? — IDP](https://blog.idp.edu.br/direito-digital/artigo-20-lgpd-revisao-decisoes-automatizadas/)

**Predição em saúde (para a seção E)**
- [Classification model for reducing absenteeism of nurses at hospitals — Springer](https://link.springer.com/article/10.1007/s13198-024-02334-7)
- [Development of a Data-Based Method for Predicting Nursing Workload — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12440230/)

**Interno**
- [`docs/planos/2026-06-26-estudo-auto-escala-inteligente.md`](2026-06-26-estudo-auto-escala-inteligente.md) — o estudo de junho, cuja "Opção B vencedora" nunca foi implementada como proposta
- `src/utils/intelligentScaleGenerator.ts` · `src/utils/complianceEngine.ts` · `src/app/(dashboard)/ajuda/page.tsx`
- `CLAUDE.md` — armadilhas 2, 5, 10, 13, 14 e a seção de conformidade da v1.22.0

---
*Estudo elaborado em 21/08/2026. Nenhum código foi escrito e nenhuma migration foi criada.
Todos os números de produção citados vêm da documentação do repositório e **precisam ser
reconferidos contra o banco** antes de sustentar qualquer decisão — o próprio `CLAUDE.md` avisa
repetidamente que contagens envelhecem.*
