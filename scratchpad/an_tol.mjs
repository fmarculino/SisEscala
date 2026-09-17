import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.production','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY,H={apikey:K,Authorization:`Bearer ${K}`}
const r = await fetch(`${U}/rest/v1/configuracoes_globais?select=chave,valor&chave=in.(rep_tolerancia_alocacao_minutos,rep_janela_duplicidade_segundos,timezone)`,{headers:H})
console.log(JSON.stringify(await r.json()))
