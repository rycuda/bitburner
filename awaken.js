/** @param {NS} ns **/
export async function main(ns) {
	const home = new Server(ns, 'home', null)

	while (true) {
		// Make sure we have all the programs we can afford to open server ports
		if (!selectServer(home, 'darkweb') && ns.getServerMoneyAvailable('home') > 200000) ns.run('purchaseTor.js')
		home.hackingPrograms.filter(program => !ns.fileExists(program.file)).forEach(program => { if (ns.purchaseProgram(program.file)) ns.tprint(program.file) })

		await selectServer(home, 'powerhouse-fitness').installBackdoor

		// Nuke every server that we can
		for (server of home.familyOf().filter(server => !server.hasRoot && server.isNukable)) {
			await server.root()
		}

		// Backdoor the servers that need to be backdoored for faction access
		for (const faction of hackingFaction) {
			const server = selectServer(home, faction.serverName)
			if (server.isHackable && !server.isBackdoored) await server.installBackdoor()
		}

		// TODO: Manage purchased servers here

		// Re-evaluate the server we're attacking, re-task workers to attack it if needed.
		await manageWorkers(ns, home, { 'hack.js': 1, 'grow.js': 10, 'weaken.js': 2 })
		await ns.sleep(60000)
	}
}

const hackingFaction = [
	{ file: 'csec-test.msg', serverName: 'CSEC' },
	{ file: 'nitesec-test.msg', serverName: 'avmnite-02h' },
	{ file: 'j3.msg', serverName: 'I.I.I.I' },
	{ file: '19dfj3l1nd.msg', serverName: 'run4theh111z' }
]

class Server {

	constructor(ns, name, parent) {
		this.name = name;
		this.parent = parent;
		this.ns = ns;
		this.children = this.scan();
		this.isBackdoored = false;
		this.target = undefined;
		this.hackingPrograms = [
			{ file: 'BruteSSH.exe', open: this.ns.brutessh },
			{ file: 'FTPCrack.exe', open: this.ns.ftpcrack },
			{ file: 'relaySMTP.exe', open: this.ns.relaysmtp },
			{ file: 'HTTPWorm.exe', open: this.ns.httpworm },
			{ file: 'SQLInject.exe', open: this.ns.sqlinject }
		]
	}

	get isHackable() {
		return (this.hasRoot && this.hackLevelRequired <= this.ns.getHackingLevel())
	}

	get isNukable() {
		return (this.hackingPrograms.filter(x => this.ns.fileExists(x.file)).length >= this.portsRequired)
	}

	get maxRam() {
		return this.ns.getServerMaxRam(this.name)
	}

	get portsRequired() {
		return this.ns.getServerNumPortsRequired(this.name)
	}

	get maxMoney() {
		return this.ns.getServerMaxMoney(this.name)
	}

	get currentMoney() {
		return this.ns.getServerMoneyAvailable(this.name)
	}

	get hackLevelRequired() {
		return this.ns.getServerRequiredHackingLevel(this.name)
	}

	get hasRoot() {
		return this.ns.hasRootAccess(this.name)
	}

	get portsRequired() {
		return this.ns.getServerNumPortsRequired(this.name)
	}

	async installBackdoor() {
		for (const hop of this.parentsFor()) this.ns.connect(hop.name);
		this.ns.connect(this.name);
		await this.ns.installBackdoor();
		this.isBackdoored = true;
		this.ns.connect('home');
	}

	scan() {
		const names = this.ns.scan(this.name)
		var list = [];
		for (const name of names) {
			if (this.parent === null || name != this.parent.name) {
				list.push(new Server(this.ns, name, this))
			}
		}
		return list
	}

	parentsFor() {
		return (this.parentsForPrime(this, []));
	}

	parentsForPrime(node, acc) {
		if (node.parent == undefined) {
			return (acc);
		}
		return (this.parentsForPrime(node.parent, [node.parent].concat(acc)));
	}

	familyOf() {
		var list = []

		for (const child of this.children) {

			list.push(child);

			if (child.children.length > 0) {
				list.push(...child.familyOf());
			}
		}
		return list
	}

	async root() {
		if (!this.isNukable) return false
		while (this.openPorts < this.portsRequired) {
			program = this.hackingPrograms[this.openPorts];
			if (this.ns.fileExists(program.file)) {
				await program.open(this.name);
			} else {
				break;
			}
		}
		return true
	}

	async workActual() {
		return this.ns.ps().map(e => { return { filename: e.filename, threads: e.threads, args: e.args } })
	}

	async instruct(workOrder) {
		if (!compare(await this.workActual(),workOrder)) {
			await this.ns.killall(this.name)
			for (const order of workOrder) {
				await this.ns.scp(order.filename, this.name)
				await this.ns.exec(order.filename, this.name, order.threads, ...order.args) > 0
			}
		}
	}
}

function selectServer(home, target) {
	return home.familyOf().reduce((prev, curr) => { if (prev == undefined && curr.name == target) { return curr } return prev }, undefined)
}

function appraise(home) {
	return home.familyOf().filter(e => e.isHackable).sort((a, b) => a.maxMoney - b.maxMoney).pop()
}

function totalThreadCalc(ns, home, programName) {
	const scriptCost = ns.getScriptRam(programName)
	return home.familyOf().filter(x => x.hasRoot).reduce((c, e) => c += Math.floor(e.maxRam / scriptCost), 0)
}

function threadBudget(ns, home, file, ratios) {
	var threadCount = totalThreadCalc(ns, home, file)
	const multiplier = Math.floor(threadCount / Object.keys(ratios).reduce((c, e) => c = c + ratios[e], 0))
	var budget = new Map;
	Object.entries(ratios).map(([k, v]) => budget[k] = v * multiplier);
	return budget
}

async function manageWorkers(ns, home, ratio) {
	var target = appraise(home)

	var budget = threadBudget(ns, home, 'grow.js', ratio)

	for (const server of home.familyOf().filter(server => server.hasRoot && server.maxRam > 0)) {
		var workOrder = []
		var threadSpace = Math.floor(server.maxRam / ns.getScriptRam('grow.js'))
		while (threadSpace > 0) {
			const method = Object.entries(budget).filter(([k, v]) => v > 0)[0]?.[0]
			if (method === undefined) break

			if (budget[method] > threadSpace) {
				workOrder.push({ filename: method, threads: threadSpace, args: [target.name] })
				budget[method] -= threadSpace
				threadSpace = 0
			} else {
				workOrder.push({ filename: method, threads: budget[method], args: [target.name] })
				threadSpace -= budget[method]
				budget[method] = 0
			}
			await server.instruct(workOrder)
		}

	}
}

function compare(a, b) {
	var areEqual = true
	if (typeof a !== typeof b) {
		areEqual = false
	} else {
		if (typeof a === 'object') {
			if (Array.isArray(a)) {
				for (const index in a) {
					areEqual &&= compare(a[index], b[index])
				}
			} else {
				areEqual &&= compare(Object.entries(a), Object.entries(b))
			}
		} else {
			areEqual &&= (a === b)
		}
	}
	return areEqual
}
