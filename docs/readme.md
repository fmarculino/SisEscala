# Documentação do SisEscala 📑

Índice da documentação do **SisEscala** — sistema de gestão de escalas e ponto digital da
Secretaria Municipal de Saúde de Marabá (DMAC). Versão atual: **v2.8.0**.

> ⚠️ **Este diretório não é a fonte primária.** Quem for mexer no código começa pelo
> [`CLAUDE.md`](../CLAUDE.md) na raiz: é lá que estão as regras que não podem ser quebradas, as
> **armadilhas conhecidas** (cada uma com o caso real que a originou) e o mapa de onde mora a
> complexidade. Este diretório guarda o *histórico do raciocínio* — por que cada decisão foi
> tomada, o que foi medido antes e o que foi descartado.

## Por onde começar

| você quer… | leia |
|---|---|
| entender o que o sistema faz | [`README.md`](../README.md) (raiz) |
| mexer no código sem quebrar produção | [`CLAUDE.md`](../CLAUDE.md) (raiz) |
| saber o que mudou em cada versão | [`CHANGELOG.md`](../CHANGELOG.md) (raiz) |
| entender **por que** algo é como é | [`evolucao/`](evolucao/) — o diário da mudança |
| retomar um trabalho em andamento | [`planos/`](planos/) |
| executar uma rotina operacional | [`runbooks/`](runbooks/) |

⚠️ **Não confunda os dois changelogs.** O changelog vivo é o [`CHANGELOG.md`](../CHANGELOG.md) da
**raiz**. O [`changelog.md`](changelog.md) deste diretório parou na **v1.27.0 (09/08/2026)** e é
mantido apenas como histórico da série 1.x — não acrescente nada nele.

## Como a documentação é organizada

O fluxo real de trabalho produz três artefatos, nesta ordem:

1. **Plano** (`planos/`) — antes de escrever código: o que se pretende fazer, faseado, com o que
   ainda precisa ser decidido. Alguns são *estudos*, que podem terminar em "não fazer".
2. **Diário de evolução** (`evolucao/`) — depois de fazer: o que se encontrou de verdade, o que foi
   medido em produção, o que foi descartado e por quê. É o que explica uma linha de código estranha
   três meses depois.
3. **CLAUDE.md** — o destilado permanente: só o que alguém precisa saber **antes** de mexer.
   Armadilha nova, regra que não pode ser desfeita, contagem que precisa ser reconferida.

**Convenção de nome:** `AAAA-MM-DD-assunto-em-kebab-case.md`, com a data em que o trabalho foi
feito. Diários antigos ainda trazem a versão no nome (`...-v1.22.0.md`); os recentes não, porque
uma versão costuma reunir mais de uma frente.

## Diretórios

### [`evolucao/`](evolucao/) — diários de mudança

O maior conjunto (44 documentos em 22/08/2026), de junho/2026 até hoje. Cada um registra uma
frente de trabalho: o relato que a originou, a medição em produção, as decisões e o que ficou de
fora. Os mais consultados hoje:

- [`2026-08-08-conformidade-portaria-671-marcacao-de-ponto-v1.22.0.md`](evolucao/2026-08-08-conformidade-portaria-671-marcacao-de-ponto-v1.22.0.md)
  — as três regras de conformidade legal que **não podem ser desfeitas sem decisão jurídica**.
- [`2026-08-11-terminal-local-e-fechamento-fase4-rep.md`](evolucao/2026-08-11-terminal-local-e-fechamento-fase4-rep.md)
  e [`2026-08-11-app-bandeja-coletor-rep.md`](evolucao/2026-08-11-app-bandeja-coletor-rep.md)
  — integração com o relógio de ponto REP e o coletor em Go.
- [`2026-08-13-cobertura-de-ponto.md`](evolucao/2026-08-13-cobertura-de-ponto.md)
  — "estar cadastrado no relógio não é estar no ponto": o caso silencioso dos dois lados.
- [`2026-08-19-batida-de-um-dia-virando-passo-de-outro.md`](evolucao/2026-08-19-batida-de-um-dia-virando-passo-de-outro.md)
  — a alocação roda por dia, e um dia não sabe do outro.
- [`2026-08-19-mudanca-de-jornada-no-meio-da-escala.md`](evolucao/2026-08-19-mudanca-de-jornada-no-meio-da-escala.md)
  — trocar a jornada do mês reescreve os dias já trabalhados; a peça datada é a vigência.
- [`2026-08-22-intervalo-do-plantao.md`](evolucao/2026-08-22-intervalo-do-plantao.md)
  — o intervalo do plantão vinha da jornada Regular, e o zero de uma jornada de 6h anulava o guard.
- [`2026-08-22-vinculo-usuario-servidor.md`](evolucao/2026-08-22-vinculo-usuario-servidor.md)
  e [`2026-08-22-gestao-de-usuarios-pelo-rh.md`](evolucao/2026-08-22-gestao-de-usuarios-pelo-rh.md)
  — o vínculo usuário↔servidor e a abertura da gestão de usuários para o RH.

### [`planos/`](planos/) — planos e estudos

26 documentos. Alguns descrevem trabalho ainda em curso, outros são estudos que fundamentaram uma
decisão (inclusive a de não fazer). Os que continuam vivos:

- [`2026-08-08-integracao-relogio-de-ponto-rep.md`](planos/2026-08-08-integracao-relogio-de-ponto-rep.md)
  — o plano-mestre do módulo de marcações, faseado de 0 a 9. **Fases 0–4 em produção.**
- [`2026-08-20-virada-do-cei-fase5.md`](planos/2026-08-20-virada-do-cei-fase5.md)
  — a próxima unidade a ter o REP como fonte oficial de ponto.
- [`2026-08-13-vinculo-duplo-e-identificacao-no-rele.md`](planos/2026-08-13-vinculo-duplo-e-identificacao-no-rele.md)
  — pendência sem solução escolhida: duas matrículas, um CPF, um relógio.
- [`2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md`](planos/2026-08-14-estudo-faltas-automaticas-e-banco-de-horas.md)
- [`2026-08-21-estudo-aplicacao-de-ia-no-sisescala.md`](planos/2026-08-21-estudo-aplicacao-de-ia-no-sisescala.md)
  — concluído e **arquivado por decisão do usuário**; reconferir as premissas antes de retomar.

### [`runbooks/`](runbooks/) — rotinas operacionais

Passo a passo para executar, não para entender.

- [`2026-08-09-ativar-aviso-de-ponto-passo-a-passo.md`](runbooks/2026-08-09-ativar-aviso-de-ponto-passo-a-passo.md)
- [`2026-08-09-backup-dos-registros-legais.md`](runbooks/2026-08-09-backup-dos-registros-legais.md)

### [`migracao/`](migracao/) — histórico da migração inicial

Plano, lista de tarefas e relatórios da migração que originou o sistema. **Material histórico**,
mantido para rastreabilidade; não reflete o estado atual.

### [`planned_features/`](planned_features/) — ideias e levantamentos

Rascunhos anteriores à convenção de `planos/`. Confirme contra o código antes de usar qualquer um
como especificação.

## Guias de referência

| documento | do que trata | estado |
|---|---|---|
| [`GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md`](GUIA_INTEGRACAO_COMUNICACAO_E_AUTH.md) | WhatsApp multi-provedor (AstraCalls, Chatwoot, gateway genérico), SMTP e Supabase Auth PKCE | vigente |
| [`SEGURANCA.md`](SEGURANCA.md) | endurecimento de segurança: políticas de RLS, autenticação e auditoria forense | vigente, complementado pelas armadilhas do `CLAUDE.md` |
| [`guia_setup_casa.md`](guia_setup_casa.md) | configurar o ambiente de desenvolvimento apontando para o banco de homologação | vigente |
| [`ESCALABILIDADE.md`](ESCALABILIDADE.md) | diretrizes para crescer até 10.000 servidores e 150 departamentos | projeção, não medição |
| [`BENCHMARK_E_MELHORIAS.md`](BENCHMARK_E_MELHORIAS.md) | comparação com produtos de mercado e roteiro de evoluções | referência |
| [`DIAGNOSTICO_TECNICO.md`](DIAGNOSTICO_TECNICO.md) | análise de prontidão feita em **maio/2026** | histórico — o sistema mudou muito desde então |
| [`estudo_caso_Nayane_escala_alternada.md`](estudo_caso_Nayane_escala_alternada.md) | troca temporária de turno diário dentro de jornada fixa mensal | estudo de caso |
| [`changelog.md`](changelog.md) | versões da série 1.x, até a v1.27.0 | **congelado** — use o `CHANGELOG.md` da raiz |

## Duas advertências que valem para tudo aqui

⚠️ **Contagem escrita em documento envelhece.** Vários textos trazem números medidos em produção
na data em que foram escritos ("103 marcações", "`pis_pasep` vazio em 100% dos registros") e
**vários já estavam errados dias depois**. Reconfira contra o banco antes de decidir com base em
qualquer número — a data no topo do arquivo diz quando aquilo era verdade.

⚠️ **O sistema está em produção com dados reais de servidores públicos.** Erro aqui vira folha de
ponto errada e problema jurídico. Nenhum documento deste diretório autoriza rodar nada em produção
sem pedir antes.
