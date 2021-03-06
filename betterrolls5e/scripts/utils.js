import { isAttack, isSave } from "./betterrolls5e.js";
import { getSettings } from "./settings.js";
import { DND5E } from "../../../systems/dnd5e/module/config.js";

export const dnd5e = DND5E;

/**
 * Shorthand for both game.i18n.format() and game.i18n.localize() depending
 * on whether data is supplied or not
 * @param {string} key 
 * @param {object?} data optional data that if given will do a format() instead 
 */
export function i18n(key, data=null) {
	if (data) {
		return game.i18n.format(key, data);
	}

	return game.i18n.localize(key);
}

/**
 * Check if the maestro module is enabled and turned on.
 */
function isMaestroOn() {
	let output = false;
	try { if (game.settings.get("maestro", "enableItemTrack")) {
		output = true;
	} }
	catch { return false; }
	return output;
}

export class Utils {
	static getVersion() {
		return game.modules.get("betterrolls5e").data.version;
	}

	/**
	 * The sound to play for dice rolling. Returns null if an alternative sound
	 * from maestro or dice so nice is registered.
	 * This should be added to the chat message under sound.
	 * @param {boolean} hasMaestroSound optional parameter to denote that maestro is enabled
	 * @returns {string}
	 */
	static getDiceSound(hasMaestroSound=false) {
		const has3DDiceSound = game.dice3d ? game.settings.get("dice-so-nice", "settings").enabled : false;
		const playRollSounds = game.settings.get("betterrolls5e", "playRollSounds")

		if (playRollSounds && !has3DDiceSound && !hasMaestroSound) {
			return CONFIG.sounds.dice;
		}
		
		return null;
	}
	
	/**
	 * Additional data to attach to the chat message.
	 */
	static getWhisperData() {
		let rollMode = null;
		let whisper = undefined;
		let blind = null;
		
		rollMode = game.settings.get("core", "rollMode");
		if ( ["gmroll", "blindroll"].includes(rollMode) ) whisper = ChatMessage.getWhisperRecipients("GM");
		if ( rollMode === "blindroll" ) blind = true;
		else if ( rollMode === "selfroll" ) whisper = [game.user._id];
		
		return { rollMode, whisper, blind }
	}

	/**
	 * Tests a roll to see if it crit, failed, or was mixed.
	 * @param {Roll} roll 
	 * @param {number} threshold optional crit threshold
	 * @param {boolean|number[]} critChecks dice to test, true for all
	 * @param {Roll?} bonus optional bonus roll to add to the total
	 */
	static processRoll(roll, threshold, critChecks=true, bonus=null) {
		if (!roll) return null;

		let high = 0;
		let low = 0;
		for (const d of roll.dice) {
			if (d.faces > 1 && (critChecks == true || critChecks.includes(d.faces))) {
				for (const result of d.results.filter(r => !r.rerolled)) {
					if (result.result >= (threshold || d.faces)) {
						high += 1;
					} else if (result.result == 1) {
						low += 1;
					}
				}
			}
		}

		let critType = null;
		if (high > 0 && low > 0) {
			critType = "mixed";
		} else if (high > 0) {
			critType = "success";
		} else if (low > 0) {
			critType = "failure";
		}

		return {
			roll,
			total: roll.total + (bonus?.total ?? 0),
			ignored: roll.ignored ? true : undefined, 
			critType, 
			isCrit: high > 0,
		};
	}

	/**
	 * Returns an {adv, disadv} object when given an event.
	 * This one is done via a dialog, and will likely be tweaked eventually
	 */ 
	static async eventToAdvantage(ev, itemType) {
		if (ev.shiftKey) {
			return {adv:1, disadv:0};
		} else if ((keyboard.isCtrl(ev))) {
			return {adv:0, disadv:1};
		} else if (getSettings().queryAdvantageEnabled) {
			// Don't show dialog for items that aren't tool or weapon.
			if (itemType != null && !itemType.match(/^(tool|weapon)$/)) {
				return {adv:0, disadv:0};
			}
			return new Promise(resolve => {
				new Dialog({
					title: i18n("br5e.querying.title"),
					buttons: {
						disadvantage: {
							label: i18n("br5e.querying.disadvantage"),
							callback: () => resolve({adv:0, disadv:1})
						},
						normal: {
							label: i18n("br5e.querying.normal"),
							callback: () => resolve({adv:0, disadv:0})
						},
						advantage: {
							label: i18n("br5e.querying.advantage"),
							callback: () => resolve({adv:1, disadv:0})
						}
					}
				}).render(true);
			});
		} else {
			return {adv:0, disadv:0};
		}
	}

	/**
	 * Get roll state modifiers given a browser event
	 * @param {*} ev 
	 */
	static getEventRollModifiers(eventToCheck) {
		const result = {};
		if (!eventToCheck) { return; }
		if (eventToCheck.shiftKey) {
			result.adv = 1;
		}
		if (keyboard.isCtrl(eventToCheck)) {
			result.disadv = 1;
		}

		return result;
	}

	/**
	 * Determines rollstate based on several parameters
	 * @param {object} param0
	 * @returns {import("./fields.js").RollState}
	 */
	static getRollState({rollState=null, event=null, adv=null, disadv=null}={}) {
		if (rollState) return rollState;

		if (adv || disadv) {
			adv = adv || 0;
			disadv = disadv || 0;
			if (adv > 0 || disadv > 0) {
				if (adv > disadv) { return "highest"; }
				else if (adv < disadv) { return "lowest"; }
			} else { 
				return null;
			}
		}

		if (event) {
			const modifiers = Utils.getEventRollModifiers(event);
			if (modifiers.adv || modifiers.disadv) {
				return Utils.getRollState(modifiers);
			}
		}

		return null;
	}

	/**
	 * Returns an item and its actor if given an item, or just the actor otherwise.
	 * @param {Item | Actor} actorOrItem
	 */
	static resolveActorOrItem(actorOrItem) {
		if (!actorOrItem) {
			return {};
		}

		if (actorOrItem instanceof Item) {
			return { item: actorOrItem, actor: actorOrItem?.actor };
		} else {
			return { actor: actorOrItem };
		}
	}

	/**
	 * Returns roll data for an arbitrary item or actor.
	 * Returns the item's roll data first, and then falls back to actor
	 * @returns {object}
	 */
	static getRollData({item = null, actor = null, abilityMod, slotLevel=undefined}) {
		return item ?
			ItemUtils.getRollData(item, { abilityMod, slotLevel }) :
			actor?.getRollData() ?? {};
	}

	/**
	 * Returns all selected actors
	 * @param param1.required True if a warning should be shown if the list is empty
	 */
	static getTargetActors({required=false}={}) {
		const character = game.user.character;
		const controlled = canvas.tokens.controlled;
		if (!controlled.length && character) {
			return [character];
		}

		const results = controlled.map(character => character.actor).filter(a => a);
		if (required && !controlled.length) {
			ui.notifications.warn(game.i18n.localize("DND5E.ActionWarningNoToken"));
		}

		return results;
	}

	/**
	 * Returns all roll context labels used in roll terms.
	 * Catches things like +1d8[Thunder] active effects
	 * @param  {...any} rolls One or more rolls to extract roll flavors from
	 */
	static getRollFlavors(...rolls) {
		const flavors = new Set();
		for (const roll of rolls) {
			for (const term of (roll?.terms ?? roll?.rolls ?? [])) {
				if (term.options?.flavor) {
					flavors.add(term.options.flavor);
				}
				if (term.terms || term.rolls) {
					Utils.getRollFlavors(term).forEach(flavors.add.bind(flavors));
				}
			}
		}

		return Array.from(flavors);
	}
}

export class ActorUtils {
	/**
	 * Returns a special id for a token that can be used to retrieve it
	 * from anywhere.
	 * @param {*} token 
	 */
	static getTokenId(token) {
		return [canvas.tokens.get(token.id).scene.id, token.id].join(".")
	}

	/**
	 * True if the actor has the halfling luck special trait.
	 * @param {Actor} actor 
	 */
	static isHalfling(actor) {
		return getProperty(actor, "data.flags.dnd5e.halflingLucky");
	}
		
	/**
	 * True if the actor has the reliable talent special trait.
	 * @param {Actor} actor 
	 */
	static hasReliableTalent(actor) {
		return getProperty(actor, "data.flags.dnd5e.reliableTalent");
	}

	/**
	 * True if the actor has the elven accuracy feature
	 * @param {Actor} actor 
	 */
	static hasElvenAccuracy(actor) {
		return getProperty(actor, "data.flags.dnd5e.elvenAccuracy");
	}
	
	/**
	 * True if the actor has elven accuracy and the ability
	 * successfully procs it.
	 * @param {Actor} actor 
	 * @param {string} ability ability mod shorthand
	 */
	static testElvenAccuracy(actor, ability) {
		return ActorUtils.hasElvenAccuracy(actor) && ["dex", "int", "wis", "cha"].includes(ability);
	}

	/**
	 * Returns the number of additional melee extra critical dice.
	 * @param {*} actor 
	 */
	static getMeleeExtraCritDice(actor) {
		return actor?.getFlag("dnd5e", "meleeCriticalDamageDice") ?? 0;
	}

	/**
	 * Returns the crit threshold of an actor. Returns null if no actor is given.
	 * @param {Actor} actor the actor who's data we want
	 * @param {"weapon" | "spell" | undefined} itemType the item type we're dealing with
	 */
	static getCritThreshold(actor, itemType) {
		if (!actor) return 20;

		const actorFlags = actor.data.flags.dnd5e || {};
		if (itemType === "weapon" && actorFlags.weaponCriticalThreshold) {
			return parseInt(actorFlags.weaponCriticalThreshold);
		} else if (itemType === "spell" && actorFlags.spellCriticalThreshold) {
			return parseInt(actorFlags.spellCriticalThreshold);
		} else {
			return 20;
		}
	}

	/**
	 * Returns the image to represent the actor. The result depends on BR settings.
	 * @param {Actor} actor
	 */
	static getImage(actor) {
		if (!actor) return null;

		const actorImage = (actor.data.img && actor.data.img !== DEFAULT_TOKEN && !actor.data.img.includes("*")) ? actor.data.img : false;
		const tokenImage = actor.token?.data?.img ? actor.token.data.img : actor.data.token.img;

		switch(game.settings.get("betterrolls5e", "defaultRollArt")) {
			case "actor":
				return actorImage || tokenImage;
			case "token":
				return tokenImage || actorImage;
		}
	}

	/**
	 * Returns a roll object for a skill check
	 * @param {Actor} actor 
	 * @param {string} skill
	 * @returns {Promise<Roll>} 
	 */
	static getSkillCheckRoll(actor, skill) {
		return actor.rollSkill(skill, { 
			fastForward: true,
			chatMessage: false,
			advantage: false,
			disadvantage: false
		});
	}

	/**
	 * Returns a roll object for an ability check
	 * @param {Actor} actor 
	 * @param {string} abl
	 * @returns {Promise<Roll>}
	 */
	static getAbilityCheckRoll(actor, abl) {
		return actor.rollAbilityTest(abl, {
			fastForward: true,
			chatMessage: false,
			advantage: false,
			disadvantage: false
		});
	}

	/**
	 * Returns a roll object for an ability save
	 * @param {Actor} actor 
	 * @param {string} abl
	 * @returns {Promise<Roll>}
	 */
	static getAbilitySaveRoll(actor, abl) {
		return actor.rollAbilitySave(abl, {
			fastForward: true,
			chatMessage: false,
			advantage: false,
			disadvantage: false
		});
	}
}

export class ItemUtils {
	static getActivationData(item) {
		const { activation } = item.data.data;
		const activationCost = activation?.cost ?? "";

		if (activation?.type && activation?.type !== "none") {
			return `${activationCost} ${dnd5e.abilityActivationTypes[activation.type]}`.trim();
		}

		return null;
	}

	/**
	 * Creates the lower of the item crit threshold, the actor crit threshold, or 20.
	 * Returns null if null is given.
	 * @param {*} item 
	 */
	static getCritThreshold(item) {
		if (!item) return null;

		// Get item crit. If its a weapon or spell, it might have a DND flag to change the range
		// We take the smallest item crit value
		let itemCrit = Number(getProperty(item, "data.flags.betterRolls5e.critRange.value")) || 20;
		const characterCrit = ActorUtils.getCritThreshold(item.actor, item.data.type);
		return Math.min(20, characterCrit, itemCrit);
	}

	static getDuration(item) {
		const {duration} = item.data.data;

		if (!duration?.units) {
			return null;
		}

		return `${duration.value ? duration.value : ""} ${dnd5e.timePeriods[duration.units]}`.trim()
	}

	static getRange(item) {
		const { range } = item.data.data;
	
		if (!range?.value && !range?.units) {
			return null;
		}
	
		const standardRange = range.value || "";
		const longRange = (range.long && range.long !== range.value) ? `/${range.long}` : "";
		const rangeUnit = range.units ? dnd5e.distanceUnits[range.units] : "";
	
		return `${standardRange}${longRange} ${rangeUnit}`.trim();
	}

	static getSpellComponents(item) {
		const { vocal, somatic, material } = item.data.data.components;

		let componentString = "";

		if (vocal) {
			componentString += i18n("br5e.chat.abrVocal");
		}

		if (somatic) {
			componentString += i18n("br5e.chat.abrSomatic");
		}

		if (material) {
			const materials = item.data.data.materials;
			componentString += i18n("br5e.chat.abrMaterial");

			if (materials.value) {
				const materialConsumption = materials.consumed ? i18n("br5e.chat.consumedBySpell") : ""
				componentString += ` (${materials.value}` + ` ${materialConsumption})`;
			}
		}

		return componentString || null;
	}

	static getTarget(item) {
		const { target } = item.data.data;

		if (!target?.type) {
			return null;
		}

		const targetDistance = target.units && target?.units !== "none" ? ` (${target.value} ${dnd5e.distanceUnits[target.units]})` : "";
		return i18n("Target: ") + dnd5e.targetTypes[target.type] + targetDistance;
	}

	/**
	 * Ensures that better rolls flag data is set on the item if applicable.
	 * Performs an item update if anything was set and commit is true
	 * @param {Item} itemData item to update
	 * @param {boolean} commit whether to update at the end or not
	 */
	static async ensureFlags(item, { commit=true } = {}) {
		const flags = this.ensureDataFlags(item?.data);
		
		// Save the updates. Foundry checks for diffs to avoid unnecessary updates
		if (commit) {
			await item.update({"flags.betterRolls5e": flags}, { diff: true });
		}
	}

	/**
	 * Assigns the data flags to the item. Does not save to database.
	 * @param {*} itemData The item.data property to be updated
	 */
	static ensureDataFlags(itemData) {
		if (!itemData || CONFIG.betterRolls5e.validItemTypes.indexOf(itemData.type) == -1) { return; }
		
		// Initialize flags
		itemData.flags = itemData.flags ?? {};
		const baseFlags = duplicate(CONFIG.betterRolls5e.allFlags[itemData.type.concat("Flags")]);
		let flags = duplicate(itemData.flags.betterRolls5e ?? {});
		flags = mergeObject(baseFlags, flags ?? {});
		
		// If quickDamage flags should exist, update them based on which damage formulae are available
		if (CONFIG.betterRolls5e.allFlags[itemData.type.concat("Flags")].quickDamage) {
			let newQuickDamageValues = [];
			let newQuickDamageAltValues = [];
			
			// Make quickDamage flags if they don't exist
			if (!flags.quickDamage) {
				flags.quickDamage = {type: "Array", value: [], altValue: []};
			}
			
			for (let i = 0; i < itemData.data.damage?.parts.length; i++) {
				newQuickDamageValues[i] = flags.quickDamage.value[i] ?? true;
				newQuickDamageAltValues[i] = flags.quickDamage.altValue[i] ?? true;
			}
	
			flags.quickDamage.value = newQuickDamageValues;
			flags.quickDamage.altValue = newQuickDamageAltValues;
		}
	
		itemData.flags.betterRolls5e = flags;
		return itemData.flags.betterRolls5e;
	}

	static placeTemplate(item) {
		if (item?.hasAreaTarget) {
			const template = game.dnd5e.canvas.AbilityTemplate.fromItem(item);
			if (template) template.drawPreview();
			if (item.sheet?.rendered) item.sheet.minimize();
		}
	}

	/** 
	 * Finds if an item has a Maestro sound on it, in order to determine whether or not the dice sound should be played.
	 */
	static hasMaestroSound(item) {
		return (isMaestroOn() && item.data.flags.maestro && item.data.flags.maestro.track) ? true : false;
	}

	/**
	 * Returns the ability mod the item uses for the attack.
	 * If no item is given, returns null.
	 * This does not use the built in Item.abilityMod because that one doesn't handle feats
	 * @param {*} itm 
	 */
	static getAbilityMod(itm) {
		if (!itm) return null;

		const itemData = itm.data.data;
		const actorData = itm.actor.data.data;

		// If there is already an ability configured, use it
		if (itemData.ability) return itemData.ability;
	
		// If the item is a finesse weapon, and abl is "str", or "dex", or default
		if ((itm.data.type == "weapon") && itemData.properties.fin) {
			if (actorData.abilities.str.mod >= actorData.abilities.dex.mod) {
				return "str";
			} else {
				return "dex";
			}
		} 
		
		// Spells
		if (itm.data.type == "spell") {
			return actorData.attributes.spellcasting || "int";
		} 
		
		// Weapons or feats
		if (["weapon", "feat"].includes(itm.data.type)) {
			// Weapons / Feats, based on the "Action Type" field
			switch (itemData.actionType) {
				case "mwak":
					return "str";
				case "rwak":
					return "dex";
				case "msak":
				case "rsak":
					return actorData.attributes.spellcasting;
			}
		}

		return null;
	}

	/**
	 * Checks if the item applies savage attacks (bonus crit).
	 * Returns false if the actor doesn't have savage attacks, if the item
	 * is not a weapon, or if there is no item.
	 * @param {item?} item 
	 */
	static getExtraCritDice(item) {
		if (item?.actor && item?.data.type === "weapon") {
			return ActorUtils.getMeleeExtraCritDice(item.actor);
		}

		return false;
	}

	/**
	 * Gets the item's roll data.
	 * This uses item.getRollData(), but with a different
	 * ability mod formula that handles feat weapon types.
	 * If core ever swaps supports feat weapon types / levels, swap back.
	 * @param {*} item 
	 */
	static getRollData(item, { abilityMod, slotLevel=undefined } = {}) {
		const rollData = item.getRollData();

		const abl = abilityMod ?? this.getAbilityMod(item);
		rollData.mod = rollData.abilities[abl]?.mod || 0;

		if (slotLevel) {
			rollData.item.level = slotLevel;
		}

		return rollData;
	}

	/**
	 * Returns a roll object that is used to roll the item attack roll.
	 * @param {*} item 
	 */
	static getAttackRoll(item) {	
		const { rollData, parts } = item.getAttackToHit();

		// Halfling Luck check and final result
		const d20String = ActorUtils.isHalfling(item.actor) ? "1d20r<2" : "1d20";
		return new Roll([d20String, ...parts].join("+"), rollData);
	}

	/**
	 * Gets the tool roll for a specific item.
	 * This is a general item mod + proficiency d20 check.
	 * @param {Item} itm 
	 * @param {number?} bonus 
	 */
	static getToolRoll(itm, bonus=null) {
		const itemData = itm.data.data;
		const actorData = itm.actor.data.data;

		const parts = [];
		const rollData = ItemUtils.getRollData(itm);

		// Add ability modifier bonus
		if (itemData.ability) {
			const abl = itemData.ability;
			const mod = abl ? actorData.abilities[abl].mod : 0;
			if (mod !== 0) {
				parts.push("@mod");
				rollData.mod = mod;
			}
		}

		// Add proficiency, expertise, or Jack of all Trades
		if (itemData.proficient) {
			parts.push("@prof");
			rollData.prof = Math.floor(itemData.proficient * actorData.attributes.prof);
		}
		
		// Add item's bonus
		if (itemData.bonus) {
			parts.push("@bonus");
			rollData.bonus = itemData.bonus.value;
		}
		
		if (bonus) {
			parts.push(bonus);
		}
		
		// Halfling Luck check and final result
		const d20String = ActorUtils.isHalfling(itm.actor) ? "1d20r<2" : "1d20";
		return new Roll([d20String, ...parts].join("+"), rollData);
	}

	/**
	 * Returns the base crit formula, before applying settings to it.
	 * Only useful really to test if a crit is even possible
	 * @param {string} baseFormula 
	 * @returns {Roll | null} the base crit formula, or null if there is no dice
	 */
	static getBaseCritRoll(baseFormula) {
		if (!baseFormula) return null;
		
		const critFormula = baseFormula.replace(/[+-]+\s*(?:@[a-zA-Z0-9.]+|[0-9]+(?![Dd]))/g,"").concat();
		let critRoll = new Roll(critFormula);
		if (critRoll.terms.length === 1 && typeof critRoll.terms[0] === "number") {
			return null;
		}

		return critRoll;
	}

	/**
	 * Derives the formula for what should be rolled when a crit occurs.
	 * Note: Item is not necessary to calculate it.
	 * @param {string} baseFormula
	 * @param {number} baseTotal
	 * @param {number?} param2.critDice extra crit dice
	 * @returns {Roll | null} the crit result, or null if there is no dice
	 */
	static getCritRoll(baseFormula, baseTotal, {settings=null, extraCritDice=null}={}) {
		let critRoll = ItemUtils.getBaseCritRoll(baseFormula);
		if (!critRoll) return null;

		critRoll.alter(1, extraCritDice ?? 0);
		critRoll.roll();

		const { critBehavior } = getSettings(settings);

		// If critBehavior = 2, maximize base dice
		if (critBehavior === "2") {
			critRoll = new Roll(critRoll.formula).evaluate({maximize:true});
		}
		
		// If critBehavior = 3, maximize base and crit dice
		else if (critBehavior === "3") {
			let maxDifference = Roll.maximize(baseFormula).total - baseTotal;
			let newFormula = critRoll.formula + "+" + maxDifference.toString();
			critRoll = new Roll(newFormula).evaluate({maximize:true});
		}

		return critRoll;
	}

	/**
	 * Returns the scaled damage formula of the spell
	 * @param {number | "versatile"} damageIndex The index to scale, or versatile
	 * @returns {string | null} the formula if scaled, or null if its not a spell
	 */
	static scaleDamage(item, spellLevel, damageIndex, rollData) {
		if (item?.data.type === "spell") {
			const versatile = (damageIndex === "versatile");
			if (versatile) {
				damageIndex = 0;
			}

			let itemData = item.data.data;
			let actorData = item.actor.data.data;

			const scale = itemData.scaling.formula;
			let formula = versatile ? itemData.damage.versatile : itemData.damage.parts[damageIndex][0];
			const parts = [formula];
			
			// Scale damage from up-casting spells
			if (itemData.scaling.mode === "cantrip") {
				const level = item.actor.data.type === "character" ? actorData.details.level : actorData.details.spellLevel;
				item._scaleCantripDamage(parts, scale, level, rollData);
			} else if (spellLevel && (itemData.scaling.mode === "level") && itemData.scaling.formula) {
				item._scaleSpellDamage(parts, itemData.level, spellLevel, scale, rollData);
			}
			
			return parts[0];
		}
		
		return null;
	}

	
	/**
	 * A function for returning the properties of an item, which can then be printed as the footer of a chat card.
	 */
	static getPropertyList(item) {
		if (!item) return [];

		const data = item.data.data;
		let properties = [];
		
		const range = ItemUtils.getRange(item);
		const target = ItemUtils.getTarget(item);
		const activation = ItemUtils.getActivationData(item)
		const duration = ItemUtils.getDuration(item);

		switch(item.data.type) {
			case "weapon":
				properties = [
					dnd5e.weaponTypes[data.weaponType],
					range,
					target,
					data.proficient ? "" : i18n("Not Proficient"),
					data.weight ? data.weight + " " + i18n("lbs.") : null
				];
				for (const prop in data.properties) {
					if (data.properties[prop] === true) {
						properties.push(dnd5e.weaponProperties[prop]);
					}
				}
				break;
			case "spell":
				// Spell attack labels
				data.damageLabel = data.actionType === "heal" ? i18n("br5e.chat.healing") : i18n("br5e.chat.damage");
				data.isAttack = data.actionType === "attack";

				properties = [
					dnd5e.spellSchools[data.school],
					dnd5e.spellLevels[data.level],
					data.components.ritual ? i18n("Ritual") : null,
					activation,
					duration,
					data.components.concentration ? i18n("Concentration") : null,
					ItemUtils.getSpellComponents(item),
					range,
					target
				];
				break;
			case "feat":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "consumable":
				properties = [
					data.weight ? data.weight + " " + i18n("lbs.") : null,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "equipment":
				properties = [
					dnd5e.equipmentTypes[data.armor.type],
					data.equipped ? i18n("Equipped") : null,
					data.armor.value ? data.armor.value + " " + i18n("AC") : null,
					data.stealth ? i18n("Stealth Disadv.") : null,
					data.weight ? data.weight + " lbs." : null,
				];
				break;
			case "tool":
				properties = [
					dnd5e.proficiencyLevels[data.proficient],
					data.ability ? dnd5e.abilities[data.ability] : null,
					data.weight ? data.weight + " lbs." : null,
				];
				break;
			case "loot":
				properties = [data.weight ? item.data.totalWeight + " lbs." : null]
				break;
		}
		let output = properties.filter(p => (p) && (p.length !== 0) && (p !== " "));
		return output;
	}

	/**
	 * Returns an object with the save DC of the item.
	 * If no save is written in, one is calculated.
	 * @param {Item} item
	 */
	static getSave(item) {
		if (!item || !isSave(item)) {
			return null;
		}

		return {
			ability: item.data.data?.save?.ability,
			dc: item.getSaveDC()
		};
	}
}

/**
 * Class used to build a growing number of dice
 * that will be flushed to a system like Dice So Nice.
 */
export class DiceCollection {
	/** Roll object containing all the dice */
	pool = new Roll("0").roll();

	/**
	 * Creates a new DiceCollection object
	 * @param {...Roll} initialRolls optional additional dice to start with 
	 */
	constructor(...initialRolls) {
		if (initialRolls.length > 0) {
			this.push(...initialRolls);
		}
	}

	/**
	 * Creates a new dice pool from a set of rolls 
	 * and immediately flushes it, returning a promise that is
	 * true if any rolls had dice.
	 * @param {Roll[]} rolls
	 * @returns {Promise<boolean>}
	 */
	static createAndFlush(rolls) {
		return new DiceCollection(...rolls).flush();
	}

	/**
	 * Adds one or more rolls to the dice collection,
	 * for the purposes of 3D dice rendering.
	 * @param  {...Roll} rolls 
	 */
	push(...rolls) {
		for (const roll of rolls.filter(r => r)) {
			this.pool._dice.push(...roll.dice);
		}
	}

	/**
	 * Displays the collected dice to any subsystem that is interested.
	 * Currently its just Dice So Nice (if enabled).
	 * @returns {Promise<boolean>} if there were dice in the pool
	 */
	async flush() {
		// Get and reset immediately (stacking flush calls shouldn't reroll more dice)
		const pool = this.pool;
		this.pool = new Roll("0").roll();

		const hasDice = pool.dice.length > 0;
		if (game.dice3d && hasDice) {
			const wd = Utils.getWhisperData();
			await game.dice3d.showForRoll(pool, game.user, true, wd.whisper, wd.blind || false);
		}

		return hasDice;
	}
}

/**
 * Creates objects (proxies) which can be used to deserialize flags efficiently.
 * Currently this is used so that Roll objects unwrap properly.
 */
export const FoundryProxy = {
	// A set of all created proxies. Weaksets do not prevent garbage collection,
	// allowing us to safely test if something is a proxy by adding it in here
	proxySet: new WeakSet(),

	/**
	 * Creates a new proxy that turns serialized objects (like rolls) into objects.
	 * Use the result as if it was the original object.
	 * @param {*} data 
	 */
	create(data) {
		const proxy = new Proxy(data, FoundryProxy);
		FoundryProxy.proxySet.add(proxy);
		return proxy;
	},

	/**
	 * @private 
	 */
	get(target, key) {
		const value = target[key];

		// Prevent creating the same proxy again
		if (FoundryProxy.proxySet.has(value)) {
			return value;
		}

		if (value !== null && typeof value === 'object') {
			if (value.class === "Roll") {
				// This is a serialized roll, convert to roll object
				return Roll.fromData(value);
			} else if (!{}.hasOwnProperty.call(target, key)) {
				// this is a getter or setter function, so no proxy-ing
				return value;
			} else {
				// Create a nested proxy, and save the reference
				const proxy = FoundryProxy.create(value);
				target[key] = proxy;
				return proxy;
			}
		} else {
			return value;
		}
	},

	/**
	 * @private 
	 */
	set(target, key, value) {
		target[key] = value;
		return true;
	}
}
