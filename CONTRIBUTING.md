**Contributing**  
Thanks for taking a look. PocketPulse is a small project, so the process is light.  
**Setup**  
You need Node.js 22.13 or newer. There are no dependencies to install.  
git clone https://github.com/prince2bit/pocketpulse.git  
 cd pocketpulse  
 npm test  
 node src/index.js --help  
   
Use POCKETPULSE_HOME=/tmp/pp-dev node src/index.js ... to experiment without touching your own data.  
**Ground rules**  
- **Stay local.** No network access, accounts, telemetry or AI services. A test enforces the networking part.  
- **No new runtime dependencies** without a discussion first.  
- **Money is integers.** Amounts are stored in minor units and never as floats. See docs/DESIGN-DECISIONS.md.  
- **Tests come with changes.**npm test must pass. New behaviour needs a test, and bug fixes need a test that fails without the fix.  
- **Schema changes are migrations.** Never edit a released migration or categoriesV1.js; add a new migration.  
**Pull requests**  
Small, focused pull requests are easiest to review. Describe what changed and why. For larger changes, open an issue first.  
