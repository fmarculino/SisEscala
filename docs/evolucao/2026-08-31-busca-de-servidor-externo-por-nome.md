# Servidor Externo: achar a pessoa pelo nome, não pela lotação (31/08/2026)

## O problema

O modal **Adicionar Servidor Externo** da grade de escala só oferecia o caminho
**Unidade → Setor → Servidor**. Para achar a *pessoa* era preciso saber antes a **lotação** dela —
e é exatamente isso que quem escala não sabe: são **33 unidades** e **646 setores**, com nomes de
setor repetidos em ramos diferentes da mesma unidade (foi por isso que o setor já aparecia em
árvore, via `formatSectorsHierarchy`).

**Errar a unidade não dá erro nenhum**: a lista de servidores vem vazia, e quem procura conclui
que a pessoa não está cadastrada. Falha silenciosa, do mesmo tipo já registrado em outras telas.

## O que mudou

O modal ganhou, **acima** do caminho antigo, um campo **"Buscar Servidor (nome ou matrícula)"** com
busca incremental. A lotação deixa de ser pergunta e passa a ser **resposta**: ao escolher, o modal
mostra `Unidade / SETOR \ SUBSETOR · cargo` como confirmação — o que evita levar um homônimo para a
grade.

O caminho **Unidade → Setor → Servidor continua**, abaixo de um divisor "ou localize pela lotação":
quem já sabe de onde a pessoa vem acha mais rápido por ali. Os dois campos são **mutuamente
exclusivos** — escolher em um limpa o outro; dois campos apontando para servidores diferentes ao
mesmo tempo é a receita para adicionar o errado.

Nos dois caminhos, quem **já está nesta escala** aparece **desabilitado**, com o motivo escrito.
Sumir da lista faria quem procura concluir que a pessoa não existe, em vez de que ela já está lá.

## Por que precisou de RPC, e por que ela é *bounded*

Duas razões impedem resolver isso com uma consulta a `servidores` pelo cliente:

1. **A RLS.** A policy de `servidores` mostra a um coordenador só o próprio escopo — e servidor
   externo é, por definição, de fora dele. A lista viria vazia justamente nos casos que o campo
   existe para resolver.
2. **O tamanho.** São **1.393 servidores ativos** (medido em produção, 31/08/2026), acima do corte
   **silencioso** de 1.000 linhas do PostgREST (armadilha 8) — a busca pareceria funcionar e não
   acharia parte das pessoas.

`fn_buscar_servidor_para_escala(p_termo)` (migration `20260831100000`) é `SECURITY DEFINER` pelo
motivo 1 e, em troca, **nunca devolve a base inteira**: mínimo de **3 caracteres**, `LIMIT 30`.
É o mesmo padrão (e o mesmo comentário) de `fn_buscar_pendencia_rh_por_termo` e da própria
`get_external_servers_for_scale`.

| decisão | por quê |
|---|---|
| allowlist de papel **idêntica** a `get_external_servers_for_scale` (`super_admin`/`admin`/`coordenador`) | alimenta o **mesmo botão**. Ampliar aqui daria a um papel a leitura do nome e da lotação de toda a rede sem que ninguém tenha decidido isso. Se `rh`/`rh_unidade` precisarem do botão, **as duas funções mudam juntas** |
| acento-insensível por `translate`, não `unaccent` | a extensão não está instalada neste banco. Medido: 47 dos 1.393 nomes têm acento, e "JOSE" tem de achar "JOSÉ" nos dois sentidos (27 resultados em ambos) |
| curinga do usuário é **escapado** (`%`, `_`, `\`) | `_` sozinho casaria com qualquer caractere e devolveria 30 pessoas sem relação com a busca |
| só `status = 'Ativo'` | inativo fica fora da **escolha** (armadilha 28), como na RPC irmã |
| `auth.uid() IS NULL` faz bypass | `service_role` (script de conferência) passa; **anon não alcança** — o `EXECUTE` dele foi revogado |
| `REVOKE ... FROM PUBLIC, anon` + autoconferência que **aborta** | armadilha 24: `GRANT ... TO authenticated` sozinho não restringe nada, e `REVOKE` de quem não é dono só emite `WARNING` |

## O componente

`src/components/ui/SelectComBuscaRemota.tsx` — irmão de `SelectComBusca`, para lista que **não pode
ser carregada inteira** no navegador. Duas regras que não podem sair:

- **Resposta atrasada nunca sobrescreve resposta nova.** Digitar rápido dispara buscas que voltam
  fora de ordem; sem o descarte por número de sequência, a lista final é a de um termo já apagado —
  e o resultado errado é indistinguível do certo.
- **Abaixo do mínimo de caracteres a tela DIZ que não buscou.** Campo calado passa a impressão de
  que não achou nada.

Ele também avisa quando o resultado veio no teto (`Mostrando os 30 primeiros`): sem isso, uma lista
cheia parece a lista completa. Medido: `"silva"` casa com **376** dos 1.393 ativos.

⚠️ O contêiner desse modal perdeu o `overflow-hidden` (os cantos vêm de `rounded-t-xl`/`rounded-b-xl`
agora): o painel da busca é `absolute` e mais alto que o corpo do modal — recortado, mostraria duas
ou três linhas e o resto ficaria inalcançável.

## Verificação

`npx tsc --noEmit`, `npm run lint` e `npm run build` limpos. A migration é DDL — aplicar antes de o
campo funcionar; enquanto não aplicada, a busca devolve `PGRST202` e o caminho por lotação continua
funcionando normalmente. Roteiro de conferência no rodapé da própria migration.
