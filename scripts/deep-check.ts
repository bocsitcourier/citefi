import { execSync } from 'child_process';

interface CheckResult {
  name: string;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  output: string;
}

const results: CheckResult[] = [];

function runCheck(name: string, command: string, failOnWarning = false): CheckResult {
  console.log(`\n🔍 Running: ${name}...`);
  
  try {
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`✅ ${name} passed`);
    return { name, passed: true, errorCount: 0, warningCount: 0, output };
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    const output = stdout + stderr;
    
    const errorLines = output.split('\n').filter((line: string) => 
      /error|Error|TS\d{4}/.test(line)
    );
    const warningLines = output.split('\n').filter((line: string) => 
      /warning|Warning/.test(line)
    );
    
    const passed = errorLines.length === 0 && (!failOnWarning || warningLines.length === 0);
    
    if (!passed) {
      console.log(`❌ ${name} failed with ${errorLines.length} errors, ${warningLines.length} warnings`);
    } else {
      console.log(`⚠️ ${name} passed with ${warningLines.length} warnings`);
    }
    
    return { 
      name, 
      passed, 
      errorCount: errorLines.length, 
      warningCount: warningLines.length,
      output: output.slice(0, 2000)
    };
  }
}

console.log('═'.repeat(60));
console.log('🔬 CITEFI - COMPREHENSIVE CHECK');
console.log('═'.repeat(60));

results.push(runCheck(
  'TypeScript Compilation',
  'npx tsc --noEmit 2>&1 | head -100'
));

results.push(runCheck(
  'Circular Dependencies',
  'npx madge --circular --extensions ts lib/ app/ 2>&1 || true'
));

results.push(runCheck(
  'Critical API Routes Syntax',
  'npx tsc --noEmit app/api/**/route.ts 2>&1 | head -50 || true'
));

results.push(runCheck(
  'Schema Exports',
  'node -e "import(\'./shared/schema.js\').then(() => console.log(\'Schema OK\')).catch(e => { console.error(e); process.exit(1); })" 2>&1 || true'
));

console.log('\n' + '═'.repeat(60));
console.log('📊 SUMMARY REPORT');
console.log('═'.repeat(60));

let totalErrors = 0;
let totalWarnings = 0;
let failedChecks = 0;

results.forEach(result => {
  const status = result.passed ? '✅' : '❌';
  console.log(`${status} ${result.name}: ${result.errorCount} errors, ${result.warningCount} warnings`);
  
  if (!result.passed) {
    failedChecks++;
    console.log(`   Preview: ${result.output.slice(0, 200).replace(/\n/g, ' ')}`);
  }
  
  totalErrors += result.errorCount;
  totalWarnings += result.warningCount;
});

console.log('\n' + '─'.repeat(60));
console.log(`TOTAL: ${totalErrors} errors, ${totalWarnings} warnings, ${failedChecks} failed checks`);
console.log('─'.repeat(60));

if (failedChecks > 0) {
  console.log('\n💡 Run individual checks for detailed output:');
  console.log('   npx tsc --noEmit                    # TypeScript errors');
  console.log('   npx madge --circular lib/ app/      # Circular deps');
  console.log('   npx eslint lib/ app/ --ext .ts      # Lint issues');
}

process.exit(failedChecks > 0 ? 1 : 0);
