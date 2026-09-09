#!/bin/bash
# SOMENTE LEITURA. Amostra o cadastro: quais campos vem preenchidos (rfid, code, password, bars).
IP=10.110.0.20
S=$(timeout 25 curl.exe -sk -X POST "https://$IP/login.fcgi" -H 'Content-Type: application/json' \
    -d "{\"login\":\"$REP_USER\",\"password\":\"$REP_PASS\"}" | sed -n 's/.*"session"[: ]*"\([^"]*\)".*/\1/p')
[ -z "$S" ] && { echo "LOGIN FALHOU"; exit 1; }
echo "--- amostra crua de 3 usuarios (chaves devolvidas pelo device)"
timeout 40 curl.exe -sk -X POST "https://$IP/load_users.fcgi?session=$S" -H 'Content-Type: application/json' \
  -d '{"limit":3,"offset":0}' | head -c 1500
echo; echo "--- varredura de 300 usuarios: quantos com rfid/code/password/bars preenchidos"
timeout 60 curl.exe -sk -X POST "https://$IP/load_users.fcgi?session=$S" -H 'Content-Type: application/json' \
  -d '{"limit":100,"offset":0}' > "$TMPDIR/u0.json"
timeout 60 curl.exe -sk -X POST "https://$IP/load_users.fcgi?session=$S" -H 'Content-Type: application/json' \
  -d '{"limit":100,"offset":100}' > "$TMPDIR/u1.json"
timeout 60 curl.exe -sk -X POST "https://$IP/load_users.fcgi?session=$S" -H 'Content-Type: application/json' \
  -d '{"limit":100,"offset":200}' > "$TMPDIR/u2.json"
timeout 15 curl.exe -sk -X POST "https://$IP/logout.fcgi?session=$S" -H 'Content-Type: application/json' -d '{}' >/dev/null
node -e '
const fs=require("fs"); let us=[];
for(const f of ["u0","u1","u2"]){ try{ us=us.concat(JSON.parse(fs.readFileSync(process.env.TMPDIR+"/"+f+".json","utf8")).users||[]) }catch(e){} }
console.log("usuarios lidos:", us.length);
const chaves=new Set(); us.forEach(u=>Object.keys(u).forEach(k=>chaves.add(k)));
console.log("campos devolvidos:", [...chaves].join(", "));
for(const c of ["rfid","code","password","bars","barcode","admin"]){
  const n=us.filter(u=>u[c]!==undefined && u[c]!==0 && u[c]!=="" && u[c]!==null && u[c]!==false).length;
  if(chaves.has(c)) console.log(`  ${c}: ${n} de ${us.length} preenchidos`);
}
const pis=us.map(u=>String(u.pis||"")); console.log("pis distintos:", new Set(pis).size, "de", pis.length);
const reg=us.map(u=>String(u.registration||"")); console.log("registration distintos:", new Set(reg).size);
'
