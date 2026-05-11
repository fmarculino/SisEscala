const fs = require('fs');
const path = 'c:/Users/Cliente/Projetos/SisEscala/src/app/(dashboard)/auditoria/page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix imports
content = content.replace(
  "LayoutList } from 'lucide-react'",
  "LayoutList, CheckCircle2 } from 'lucide-react'"
);
content = content.replace(
  "import { applyAccessFilters } from '@/utils/permissions'",
  "import { applyAccessFilters, type UserProfile } from '@/utils/permissions'"
);

// 2. Remove redundant UserProfile
content = content.replace(
  /interface UserProfile \{[\s\S]*?\}/,
  ""
);

// 3. Fix state typing
content = content.replace(
  "const [userProfile, setUserProfile] = useState<any>(null)",
  "const [userProfile, setUserProfile] = useState<UserProfile | null>(null)"
);

// 4. Fix mapping union types
content = content.replace(
  "activeTab === 'sobreaviso' ? (\n                logs.map((log) => (",
  "activeTab === 'sobreaviso' ? (\n                (logs as LogSobreaviso[]).map((log) => ("
);
content = content.replace(
  "))\n              ) : (\n                logs.map((log) => (",
  "))\n              ) : (\n                (logs as LogSistema[]).map((log) => ("
);

// 5. Fix modal property access
// For LogSistema in modal
content = content.replace(
  "selectedLog.acao.includes('REMOVER')",
  "((selectedLog as any).acao || '').includes('REMOVER')"
);
content = content.replace(
  "selectedLog.acao.replace(/_/g, ' ')",
  "((selectedLog as any).acao || '').replace(/_/g, ' ')"
);

fs.writeFileSync(path, content);
console.log('File updated successfully');
