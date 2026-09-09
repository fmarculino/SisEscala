#!/bin/bash
# SOMENTE LEITURA. Sonda o REP da SMS: nenhuma escrita, nenhum cadastro tocado.
IP=10.110.0.20
U="${REP_USER:-admin}"; P="${REP_PASS:?defina REP_PASS}"
S=$(timeout 25 curl.exe -sk -X POST "https://$IP/login.fcgi" -H 'Content-Type: application/json' \
    -d "{\"login\":\"$U\",\"password\":\"$P\"}" | sed -n 's/.*"session"[: ]*"\([^"]*\)".*/\1/p')
[ -z "$S" ] && { echo "LOGIN FALHOU"; exit 1; }
echo "sessao ok"
for cmd in get_system_configuration get_configuration get_system_information; do
  echo "--- $cmd"
  timeout 25 curl.exe -sk -X POST "https://$IP/$cmd.fcgi?session=$S" -H 'Content-Type: application/json' -d '{}' | head -c 1200
  echo
done
echo "--- set_identification_type (SONDA COM CORPO VAZIO - nao altera nada)"
timeout 25 curl.exe -sk -X POST "https://$IP/set_identification_type.fcgi?session=$S" -H 'Content-Type: application/json' -d '{}' | head -c 600
echo
timeout 15 curl.exe -sk -X POST "https://$IP/logout.fcgi?session=$S" -H 'Content-Type: application/json' -d '{}' >/dev/null
echo "(sessao encerrada)"
