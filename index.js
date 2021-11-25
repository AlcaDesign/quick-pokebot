require('dotenv/config');

const fetch = require('node-fetch');
const tmi = require('tmi.js');

const BASE_URL = 'https://pokeapi.co/api/v2/';

const cache = new Map();

function getPokemonData(url) {
	if(cache.has(url)) {
		return cache.get(url);
	}
	const _getData = async () => {
		const res = await fetch(`${BASE_URL}${url}`);
		return res.ok ? res.json() : null;
	}
	const data = _getData();
	cache.set(url, data);
	return data;
}

const normURL = (endpoint, url) => `${endpoint}${url.toString().replace(BASE_URL, '').replace(endpoint, '')}`;

const getPokemon = input => getPokemonData(normURL('pokemon/', input));
const getPokemonSpecies = id => getPokemonData(normURL('pokemon-species/', id));
const getPokemonType = id => getPokemonData(normURL('type/', id));
const getPokemonEvolutionChain = id => getPokemonData(normURL('evolution-chain/', id));

const lang = list => list.find(n => n.language.name === 'en');

const client = new tmi.Client({
	options: {
		debug: true,
		skipMembership: true,
		messagesLogLevel: 'debug',
		skipUpdatingEmotesets: true,
		joinInterval: 300,
	},
	identity: {
		username: process.env.TMI_USER,
		password: process.env.TMI_PASS,
	},
	channels: process.env.TMI_CHANNEL.split(','),
});

client.connect();

client.on('message', async (channel, tags, message, self) => {
	if(self || !message.startsWith('!')) return;
	const args = message.slice(1).split(' ');
	const command = args.shift().toLowerCase();
	const isModUp = tags.mod || tags.badges?.broadcaster || tags.badges?.moderator;
	if(command === 'poke' && isModUp) {
		const name = args.join(' ');
		const searchName = name.toLowerCase().replace(/\s/g, '-').replace(/\./, '');
		const pokemon = await getPokemon(searchName);
		if(!pokemon) {
			console.log('Could not find pokemon', searchName);
			return;
		}
		const species = await getPokemonSpecies(pokemon.id);
		console.log(`[${pokemon.id}] ${lang(species.names).name}`);
		const types = await Promise.all(pokemon.types.map(n => getPokemonType(n.type.url)));
		const evolutionChain = await getPokemonEvolutionChain(species.evolution_chain.url);
		const getAllEvolutionRecursively = chain => {
			const evolutions = [];
			if(chain.evolves_to.length) {
				chain.evolves_to.forEach(n => {
					evolutions.push(n);
					evolutions.push(...getAllEvolutionRecursively(n));
				});
			}
			return evolutions;
		};
		const evolutions = await Promise.all([
			evolutionChain.chain, ...getAllEvolutionRecursively(evolutionChain.chain)
		].map(n =>
			getPokemonSpecies(n.species.url)
		));
		const damageRelationList = [
			'double_damage_from', 'half_damage_from', 'no_damage_from',
			'double_damage_to', 'half_damage_to', 'no_damage_to',
		];
		const damageTypes = (await Promise.all([
			...new Set(
				types.map(n =>
					damageRelationList.map(d => n.damage_relations[d])
				).flat(Infinity)
			)
		].map(n =>
			getPokemonType(n.url)
		)))
		.reduce((p, n) => (p.set(n.name, n), p), new Map());

		const textName = lang(species.names).name;
		const textTypes = types.map(n => lang(n.names).name).sort((a, b) => a.localeCompare(b)).join(' & ');
		const textGenus = lang(species.genera).genus;
		const textEvolution = evolutions.map(n => lang(n.names).name).join(' -> ');
		const [ DOUBLE, HALF, NONE ] = [ '2', '1/2', '0' ];
		const textDamage = [
			// '2x from', '1/2 from', '0 from',
			[ 'weak', DOUBLE ], [ 'strong', HALF ], [ 'strong', NONE ],
			// '2x to', '1/2 to', '0 to',
			[ 'strong', DOUBLE ], [ 'weak', HALF ], [ 'weak', NONE ],
		].reduce((p, [ label, quality ], i, arr) => {
			const key = damageRelationList[i];
			const result = types.flatMap(n =>
				n.damage_relations[key].map(m =>
					lang(damageTypes.get(m.name).names).name + (quality === DOUBLE ? '!!' : quality === HALF ? '/2' : '0')
				)
			);
			p[label].push(...result);
			if(i === arr.length - 1) {
				const sortByName = false;
				const _strong = [ ...new Set(p.strong) ];
				const _weak = [ ...new Set(p.weak) ];
				if(sortByName) {
					_strong.sort((a, b) => a.localeCompare(b));
					_weak.sort((a, b) => a.localeCompare(b));
				}
				const strong = p.strong.length ? `strong against ${_strong.join(' & ')}` : '';
				const weak = p.weak.length ? `weak against ${_weak.join(' & ')}` : '';
				return `${strong}, ${weak}`;
			}
			return p;
		}, { weak: [], strong: [] })
		'weak against', [ ...new Set(textDamage.weak) ]
		client.say(channel, `${textName} (${textGenus}) is ${textTypes} type | Evolution: ${textEvolution} | ${textDamage}`);
	}
});