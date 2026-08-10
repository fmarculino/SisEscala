# Backup dos registros legais de ponto — especificação

**Data:** 09/08/2026
**Origem:** § 5 do estudo [2026-08-09-auditoria-logs-retencao.md](../planos/2026-08-09-auditoria-logs-retencao.md).
**Estado:** especificação. **Não implementado** — é infraestrutura da VPS, fora do código da aplicação.

---

## Por que este é o item mais importante do estudo, e o menos visível

O estudo começou por uma preocupação com espaço em disco. Medindo, o espaço se mostrou um não-problema:
18,3 MB no sistema inteiro. Mas a mesma medição expôs uma lacuna de outra ordem:

> **Não existe backup próprio do SisEscala.** O banco é um Supabase self-hosted numa VPS Coolify. O
> que existe é o backup da VPS — se houver, e ninguém confirmou que há.

Para dado que a lei obriga guardar por **5 anos**, isso é frágil demais. E é a única lacuna do
estudo que **nenhuma tela revela**: tudo funciona perfeitamente até o dia em que não funciona.

Some-se que a aplicação e o banco moram **no mesmo host** (`sisescala.maraba.pa.gov.br` e
`supabase-sisescala.coolify.vps.atb.app.br`). Um backup que viva ali dentro não protege contra a
perda que mais importa: a do próprio host.

---

## O que precisa ser preservado, e por quanto tempo

| tabela | o que é | por que não pode ser reconstruída |
|---|---|---|
| `rep_afd_registros` | evidência bruta do relógio, com **cadeia de hash** | a Portaria 671 proíbe o PTRP de alterar ou eliminar o dado original; perdida, a prova acaba |
| `marcacoes_ponto` | o fato registrado pelo servidor, **INSERT-only** | é a batida em si |
| `marcacoes_tratamentos` | o juízo do coordenador sobre o fato, append-only | é o Art. 82 em forma de dado |
| `escala_diaria` · `escala_mensal` | base do cálculo de jornada | sem elas, a folha não se sustenta |
| `folha_ponto` | o documento oficial | é o que vira prova |
| `logs_preferencia_aviso_ponto` | consentimento LGPD | some junto com o direito de comprová-lo |
| `logs_tentativas_presenca` | batidas recusadas | já foi usada para **recuperar** horário real de batida negada por bug |
| `logs_sistema` | trilha de auditoria | responde "quem alterou o quê" |
| `logs_sobreaviso` · `historico_transferencias` | ciclo de acionamento e lotação | contexto do que a folha afirma |

**Prazo:** 5 anos como piso, pela prescrição trabalhista (CF Art. 7º, XXIX). Para servidor
estatutário o prontuário funcional costuma exigir mais.

Volume atual das dez tabelas: **~18 MB**. Projetando o crescimento de `marcacoes_ponto` com toda a
rede no terminal e o REP ativo, algo próximo de **1 GB em 5 anos** — cabe em qualquer lugar. Custo
não é obstáculo aqui; a ausência é que é.

---

## O mínimo defensável

### 1. Dump lógico periódico, fora da VPS

Diário, retenção escalonada (7 diários · 4 semanais · 12 mensais · 5 anuais).

```bash
# A porta 5432 é bloqueada por firewall de fora — o dump precisa rodar NA VPS
# e só depois o arquivo sai. DATABASE_URL está no .env de produção da aplicação.
pg_dump "$DATABASE_URL" \
  --format=custom --compress=9 \
  --table=public.rep_afd_registros \
  --table=public.marcacoes_ponto \
  --table=public.marcacoes_tratamentos \
  --table=public.escala_diaria \
  --table=public.escala_mensal \
  --table=public.folha_ponto \
  --table=public.logs_preferencia_aviso_ponto \
  --table=public.logs_tentativas_presenca \
  --table=public.logs_sistema \
  --table=public.logs_sobreaviso \
  --table=public.historico_transferencias \
  --table=public.servidores \
  --table=public.unidades --table=public.setores \
  --file="sisescala_registros_$(date +%Y%m%d).dump"
```

`servidores`, `unidades` e `setores` entram porque um dump de ponto sem a identidade de quem bateu
e de onde é ilegível — restaurar `marcacoes_ponto` sozinha devolve UUIDs.

**O destino tem de ser outro host.** Object storage do município, outro provedor, ou até uma
máquina na secretaria — o que não pode é ficar na mesma VPS.

### 2. Export assinado do AFD por competência

`rep_afd_registros` já guarda `linha_bruta` com cadeia de hash. Exportar o **arquivo AFD original**
por mês e arquivá-lo separadamente preserva a prova no formato que o auditor fiscal conhece — um
dump Postgres não é AFD.

Isto vira relevante quando a Fase 5 do módulo REP entrar; hoje há 26 registros de piloto.

### 3. Conferência de restauração

**Backup nunca testado não é backup.** Ao menos uma vez, e depois a cada semestre:

1. restaurar o dump num banco descartável;
2. conferir a contagem das tabelas contra a produção;
3. rodar uma consulta de negócio — por exemplo, a folha de um servidor num mês fechado — e
   comparar com o que a produção mostra.

O passo 3 é o que realmente valida: contagem igual não prova que o dado é utilizável.

---

## O que **não** resolve

- **Réplica não é backup.** Réplica copia o erro junto: um `DELETE` acidental chega ao standby em
  segundos. Réplica protege contra falha de hardware, não contra engano humano — e o estudo
  mostrou que este projeto já teve `DELETE` de dado em produção.
- **Snapshot da VPS não é suficiente sozinho.** Ajuda, mas mora no mesmo provedor e restaurá-lo
  significa restaurar a máquina inteira, não uma tabela.
- **O expurgo da Fase F não substitui isto.** Ele nem toca em nenhuma destas tabelas.

---

## Decisões pendentes

1. **Onde guardar** — object storage do município, outro provedor, ou máquina na secretaria?
2. **Quem opera** — a TI da SMS ou quem administra a VPS?
3. **Quem confere a restauração**, e com que periodicidade?
4. **Retenção do próprio backup** — 5 anos alinhado ao dado, ou mais?

Nenhuma dessas é decisão de código, e por isso este documento é especificação e não implementação.
Se a resposta de (1) for algum destino com API, dá para automatizar o envio a partir de uma
Scheduled Task do Coolify — nesse caso me diga o destino e eu escrevo o script.
