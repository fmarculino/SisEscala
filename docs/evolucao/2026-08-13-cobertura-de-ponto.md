# Cobertura de ponto: quem está escalado e não consegue bater (13/08/2026)

**Versão:** app `1.64.2` · migration `20260813000000_add_cobertura_ponto_rep.sql`
**Contexto do dia:** [`2026-08-13-implantacao-lacem-diario.md`](2026-08-13-implantacao-lacem-diario.md)

## A pergunta e a medição

"Todos os servidores do LACEM que estão nas escalas estão efetivamente no ponto?" — feita durante
a instalação do coletor na unidade. A resposta, medida em produção contra agosto/2026:

| situação | servidores |
|---|---|
| bate e não registra (sem vínculo) | **27** |
| fora do relógio | 10 |
| sem biometria | 1 |
| pronto para bater | **1** |
| **total escalado** | **39** |

Um de trinta e nove — número confirmado depois pela própria tela, contra o mesmo mês. E o caso
dominante é o pior tipo de falha: a pessoa **está** cadastrada no
equipamento, **com biometria**, encosta o dedo, o relógio aceita e grava no AFD — e a batida morre
como órfã no SisEscala porque não existe `rep_vinculos_servidor` ligando aquele identificador ao
servidor. Falha silenciosa dos dois lados: nada no relógio recusa, nada na tela avisava. É o mesmo
padrão do log de sync da LACEM de 12/08 (`marcacoes == orfas` em todo lote), agora com nome e
matrícula de quem está sendo afetado.

Nenhuma tela do módulo respondia isso. "Biometria Pendente" só lista quem **já tem vínculo**;
"Higiene do Relógio" olha na direção inversa (quem está no relógio e não no SisEscala). A ponta
que faltava era escala → relógio, justamente a que diz se a folha do mês vai existir.

## O que foi feito

| peça | onde |
|---|---|
| classificação por servidor (fonte única) | `fn_cobertura_ponto_dispositivo` |
| resumo por relógio (envelope LATERAL) | `fn_cobertura_ponto_resumo` |
| conserto do caso dominante | `fn_vincular_cadastros_por_cpf` |
| conserto do `fora_do_relogio` | `fn_enfileirar_cadastros_por_escala` |
| tela | aba **Cobertura da Escala** em `/marcacoes` |
| alerta | contador vermelho no rótulo da aba, carregado junto com a página |

Seis situações, da pior para a melhor: `sem_vinculo` → `fora_do_relogio` → `sem_biometria` →
`sem_cpf` → `sem_snapshot` → `ok`. Cada uma diz na tela o que resolve — e três delas resolvem em
lugares diferentes (SisEscala, coletor, ou alguém indo fisicamente até o equipamento).

O alerta carrega **com a página**, não quando a aba é aberta: o valor dele é avisar exatamente
quem não ia clicar. Falha em silêncio se a RPC der erro — um alerta não pode derrubar a tela.

## Decisões que não podem ser desfeitas sem pensar

**A classificação mora num lugar só.** `fn_cobertura_ponto_resumo` é envelope `LATERAL` de
`fn_cobertura_ponto_dispositivo`, e a tela não reclassifica nada — mesmo padrão de
`fn_blocos_previstos_mes` sobre `fn_blocos_previstos_dia`. Se o resumo derivasse por conta
própria, o número do alerta deixaria de ser o número da lista, que é o jeito clássico de um painel
perder credibilidade.

**`sem_snapshot` existe para não fabricar alarme.** Quando o coletor nunca leu o cadastro do
relógio, dizer "fora do relógio" seria afirmar algo que não se sabe. A situação separada diz a
verdade: ninguém leu ainda.

**`batidas perdidas` é evidência, não inferência.** Conta registros tipo 3 no AFD dos últimos 30
dias que não têm vínculo cobrindo a data — ou seja, gente comprovadamente batendo sem que nada
seja registrado. É o número que transforma "faltam vínculos" em "27 pessoas estão perdendo ponto
desde tal dia".

**`p_vigente_de` é o parâmetro perigoso de `fn_vincular_cadastros_por_cpf`.** A resolução de
vínculo é *vigente na data da batida* (`fn_ingerir_afd` e `fn_reparse_afd_dispositivo`), então um
`vigente_de` antigo demais faria o histórico do sistema **anterior** (a LACEM chegou com ~34.500
marcações de outro sistema) virar registro de ponto do SisEscala no primeiro reprocessamento. O
default é `dispositivos_rep.created_at` — a fronteira "daqui pra frente este relógio é nosso" — e
nunca a primeira batida vista no AFD.

**Criar vínculo e recuperar histórico são duas decisões diferentes.** A função não reprocessa
nada: batida já ingerida continua órfã até alguém rodar `fn_reparse_afd_dispositivo` de propósito,
porque isso mexe em ponto passado.

## O `fora_do_relogio` tinha uma causa que ninguém veria

Perguntado no mesmo dia, olhando a grade de agosto: **Gabriela Santos Moreno** e **Izabella
Borges Carvalho** estão escaladas, batem ponto no terminal do computador todo dia, e não estão no
relógio. Por que o "Sincronizar cadastros" nunca as levou?

Porque `fn_enfileirar_cadastros_rep` (Fase 7) escolhe candidato **por lotação** —
`servidores.unidade_id = dispositivo.unidade_id`, mais o setor quando o relógio é de setor. Quem
está **escalado** na unidade mas lotado em outro lugar nunca entra por ali, e o botão responde
"0 enfileirados" sem dizer que aquela pessoa existia e ficou de fora. Clicar de novo não muda
nada, para sempre.

Duas peças saíram disso:

- `fn_cobertura_ponto_dispositivo` passou a devolver `fila_status`, `fila_erro` e
  `lotacao_compativel`. São eles que separam as três causas de continuar fora do relógio —
  *na fila, esperando o coletor* · *o envio falhou, com a mensagem* · *lotação divergente, o botão
  não pega* — e a tela imprime a frase certa em vez de mandar todo mundo para o mesmo botão.
- `fn_enfileirar_cadastros_por_escala` enfileira exatamente quem a tela mostra como
  `fora_do_relogio`, ou seja **por escala**. É a mesma escolha do guard de
  `fn_blocos_previstos_dia` (checa por escala, não por lotação, para não quebrar servidor
  externo/emprestado). Não substitui a função da Fase 7 — é um segundo caminho, para o caso que
  aquele não alcança — e continua sem escrever no equipamento: enfileirar é intenção, quem aplica
  é o coletor.

## O que ainda não responde

- **Unidade escalada sem relógio nenhum** não aparece — a tela é por dispositivo. Quando a Fase 5
  avançar, vale um "unidades sem cobertura".
- A projeção para `escala_diaria` continua desligada (Fase 5): mesmo com vínculo, a batida vira
  marcação no módulo, não linha de folha.
- O escopo da escala é `escala_mensal.unidade_id` (e `setor_id` quando o relógio é de setor). Um
  servidor externo escalado ali entra na conta, e é o comportamento desejado — quem está escalado
  precisa conseguir bater.
