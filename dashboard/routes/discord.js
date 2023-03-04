const express = require("express"),
	router = express.Router(),
	Discord = require("discord.js");

const fetch = require("node-fetch"),
	btoa = require("btoa");

// Gets login page
router.get("/login", async function (req, res) {
	if (!req.user || !req.user.id || !req.user.guilds) {
		return res.redirect(
			`https://discordapp.com/api/oauth2/authorize?client_id=${
				req.client.user.id
			}&scope=identify%20guilds&response_type=code&redirect_uri=${encodeURIComponent(
				req.client.config.dashboard.baseURL + "/api/callback"
			)}&state=${req.query.state || "no"}`
		);
	}
	res.redirect("/auth/steam");
});

router.get("/callback", async (req, res) => {
	if (!req.query.code)
		return res.redirect(req.client.config.dashboard.failureURL);
	if (req.query.state && req.query.state.startsWith("invite")) {
		if (req.query.code) {
			const guildID = req.query.state.substr(
				"invite".length,
				req.query.state.length
			);
			req.client.knownGuilds.push({ id: guildID, user: req.user.id });
			return res.redirect("/manage/" + guildID);
		}
	}
	const params = new URLSearchParams();
	params.set("grant_type", "authorization_code");
	params.set("code", req.query.code);
	params.set(
		"redirect_uri",
		`${req.client.config.dashboard.baseURL}/api/callback`
	);
	let response = await fetch("https://discord.com/api/oauth2/token", {
		method: "POST",
		body: params.toString(),
		headers: {
			Authorization: `Basic ${btoa(
				`${req.client.user.id}:${req.client.config.dashboard.secret}`
			)}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
	});
	// Fetch tokens (used to fetch user informations)
	const tokens = await response.json();
	// If the code isn't valid
	if (tokens.error || !tokens.access_token)
		return res.redirect(`/api/login&state=${req.query.state}`);
	const userData = {
		infos: null,
		guilds: null,
	};
	while (!userData.infos || !userData.guilds) {
		/* User infos */
		if (!userData.infos) {
			response = await fetch("https://discordapp.com/api/users/@me", {
				method: "GET",
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			});
			const json = await response.json();
			if (json.retry_after) await req.client.wait(json.retry_after);
			else userData.infos = json;
		}
		/* User guilds */
		if (!userData.guilds) {
			response = await fetch("https://discordapp.com/api/users/@me/guilds", {
				method: "GET",
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			});
			const json = await response.json();
			if (json.retry_after) await req.client.wait(json.retry_after);
			else userData.guilds = json;
		}
	}
	/* Change format (from "0": { data }, "1": { data }, etc... to [ { data }, { data } ]) */
	const guilds = [];
	for (const guildPos in userData.guilds)
		guilds.push(userData.guilds[guildPos]);
	// Update session
	req.session.user = { ...userData.infos, ...{ guilds } };
	const user = await req.client.users.fetch(req.session.user.id);
	const userDB = await req.client.findOrCreateUser({ id: user.id });
	if (userDB?.steam) req.session.passport = { user: userDB.steam };
	const logsChannel = req.client.channels.cache.get(
		req.client.config.support.logs
	);
	const regIp = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
	const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress).match(
		regIp
	);
	const redirectURL = (await req.client.linkedSteamAccount(
		req.session?.passport?.user?.steamid
	))
		? req.client.states[req.query.state]
		: "/auth/steam";
	// save the user's tag so we can use it later
	userDB.name = user.username;
	userDB.discriminator = user.discriminator;

	if (!userDB.logged && user) {
		if (!userDB.roles.includes("owner")) {
			const isOwner = await req.client.isOwner(user.id);
			if (isOwner) {
				userDB.roles.push("owner");
			}
		}

		if (logsChannel) {
			// Set logged in for the first time to true and send the embed!
			const embed = new Discord.MessageEmbed()
				.setAuthor({ name: user.username, iconURL: user.displayAvatarURL()})
				.setColor("#DA70D6")
				.setDescription(
					req.client.translate("dashboard:FIRST_LOGIN", {
						user: user.tag,
					})
				);
			await logsChannel.send({ embeds: [embed] });
		}
		userDB.logged = true;
	}

	// Set active status to true
	if (!userDB.isOnline) {
		userDB.isOnline = true;
	}
	if (ip) {
		if (!userDB.lastIp.includes(ip[0])) {
			userDB.lastIp.push(ip[0]);
			userDB.markModified("lastIp");
		}
	}
	await userDB.save();
	res.redirect(redirectURL);
});

module.exports = router;
