import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import ejs from "ejs";
import axios from "axios";
import cookieParser from "cookie-parser";
import LlamaAI from "llamaai";
import Cheerio from "cheerio";
import dotenv from "dotenv"; //necessary: loads environment variables from .env
import fs from "fs";
import nlp from "compromise";
dotenv.config();

const app = express();
const port = 3000;

app.use(express.static("public"));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.use(cookieParser());

// paste
const db = new pg.Client({
	user: "postgres",
	host: "localhost",
	database: "world",
	password: process.env.DB_PW,
	port: 5432,
});

db.connect();

var msg = "";


app.post("/login", async (req, res) => {
	const { username, password } = req.body;
	const result = await db.query("SELECT * FROM users WHERE username = $1", [
		username,
	]);
	if (result.rows.length > 0) {
		const user = result.rows[0];
		let validate = await bcrypt.compare(password, user.password);
		if (validate) {
			const token = jwt.sign(
				{ id: user.id, username: user.username },
				process.env.SECRET_TOKEN,
				{ expiresIn: "2h" }
			);
			res.cookie("token", token, { httpOnly: true });
			msg = `You are logged in as ${username}`;
			res.redirect("/");
		} else {
			msg = "Wrong password. Try again.";
			res.redirect("/");
		}
	} else {
		msg =
			"You are not in our database. Try signing up for an account or re-login.";
		res.redirect("/");
	}

	//res.redirect('/login');
});

app.post("/signup", async (req, res) => {
	const { username, password } = req.body;
	if (req.body.repassword != req.body.password) {
		res.render("signuppage.ejs", {
			wrning: "The password you re-entered does not match the new password.",
		});
	} else {
		const hashed = await bcrypt.hash(password, 10);
		db.query(
			"INSERT INTO users (username, password) VALUES ($1, $2);",
			[username, hashed],
			(err, rep) => {
				if (err) {
					res.render("loginpage.ejs", {
						alert: "You already have an account with us.",
					});
				} else {
					res.redirect("/logindirect");
				}
			}
		);
	}
});

app.post("/logout", (req, res) => {
	if(!req.headers.cookie)	{
		msg = "You are not logged in.";
		return res.redirect("/");
	}
	let token = req.headers.cookie.split("=")[1];
	const decoded = jwt.verify(token, process.env.SECRET_TOKEN);
	console.log(decoded.username);
	res.clearCookie("token");
	msg = "You have been logged out.";
	res.redirect("/");
});

const authenticate = function auth(req, res, next) {
	console.log(req.headers.cookie);
	
	if (req.headers.cookie === undefined) return res.redirect("/login");
	const token = req.headers.cookie.token;
	jwt.verify(token, process.env.SECRET_TOKEN, (err, user) => {
		if (err) return res.redirect("/login");
		req.user = user;
		next();
	});
};

//paste

const llamaAPI = new LlamaAI(process.env.API_KEY);

app.get("/recommend", async (req, res) => {
	const info = req.query.info;
	const apiRequestJson = {
		messages: [{ role: "user", content: info }],
		functions: [
			{
				name: "suggest_improvement",
				description:
					"Based on the recipe that the user created, suggest improvements in nutritional quality, ingredients used as well as measurements to enhance the taste of the dish.",
				parameters: {
					type: "object",
					properties: {
						additional_ingredients: {
							type: "object",
							description:
								"Some additions to the recipe which can enhance its taste and nutrition.",
						},
						final_recipe: {
							type: "object",
							description:
								"A description of the updated recipe with the extra ingredients.",
						},
					},
				},
				required: ["additional_ingredients", "final_recipe"],
			},
		],
		stream: false,
		function_call: "suggest_improvement",
	};
	try {
		const response = await llamaAPI.run(apiRequestJson);
		//console.log(response.choices[0].message.function_call.arguments);
		res.render("rec.ejs", { msg: response.choices[0].message.function_call.arguments });
	} catch (error) {
		console.error(error);
		res.render("index.ejs", { msg: "exception caught!" });
	}
});

app.get("/search", async (req, res) => {
	const ingre = req.query.ingredients;
	const sense = req.query.sensitivities;
	const diet = req.query.specifics;
	// let arr = [];
	// arr.push(sense);
	// arr.push(diet);
	
	let listResponse = [];
	let version1 = req.query.ingredients.charAt(0).toUpperCase() + req.query.ingredients.slice(1);
	let respInit = await db.query("SELECT * FROM recipes WHERE label LIKE $1 OR label LIKE $2", ['%'+req.query.ingredients+'%', version1]);
	let resp = respInit.rows;
	for (let i = 0; i < resp.length; i++) {
	    
		const obj = {
			title: resp[i].label,
			image_link: resp[i].image,
			src: resp[i].source,
			ingredients: resp[i].ingredientLines,
			healthLabels: resp[i].healthLabels,
			calories: resp[i].calories,
			cuisine: resp[i].cuisineType,
			link: resp[i].url,
			tags: resp[i].tags,
		};

		  //await db.query("UPDATE recipes SET image=$1 WHERE label LIKE $2;", [obj.image_link, obj.title]);
		//console.log("here");
		
		listResponse.push(obj);
	}
	res.render("search.ejs", { arr: listResponse });
});

app.post("/like", async (req, res) => {
	if (!req.headers.cookie) {
		msg = "Make an account or log in if you already have one, to save recipes to your profile.";
		return res.render("index.ejs", {msg: msg});
	}
	let token = req.headers.cookie.split("=")[1];
	
	const decoded = jwt.verify(token, process.env.SECRET_TOKEN);
	console.log(decoded.username);
	const arr = []
	arr.push(req.body.hidden)
	await db.query("UPDATE users SET likes = likes || $1 WHERE username LIKE $2", [arr, decoded.username]);
	res.render("card.ejs", { card: JSON.parse(req.body.card), alert: "Successfully saved to your profile! "});
})

app.get("/card", (req, res) => {
	const card = JSON.parse(req.query.inf);
	res.render("card.ejs", { card: card });
});

app.get("/profile", async (req, res) => {
	if(!req.headers.cookie)	{
		msg = "Login / Signup to access your personal profile.";
		return res.render("index.ejs", {msg: msg});
	}
	let token = req.headers.cookie.split("=")[1];
	if (token) {
		const decoded = jwt.verify(token, process.env.SECRET_TOKEN);
		const results = await db.query("SELECT likes FROM users WHERE username LIKE $1;", [decoded.username]);
		console.log(results.rows);
		const profile = {
			username: decoded.username,
			likes: results.rows[0].likes
			
		};
		res.render("profile.ejs", { profile: profile });
	} else {
		res.render("profile.ejs");
	}
	
	
});

app.get("/signupdirect", (req, res) => {
	res.render("signuppage.ejs");
});

app.get("/", async (req, res) => {
	
	res.render("index.ejs", { msg: msg });
});

app.get("/logindirect", (req, res) => {
	res.render("loginpage.ejs");
});

app.get("/random", async (req, res) => {
	let dat = await db.query("SELECT * FROM recipes;");
	dat = dat.rows;
	let i = Math.floor(Math.random() * dat.length);
	const obj = {
		title: dat[i].label,
		image_link: dat[i].image,
		src: dat[i].source,
		ingredients: dat[i].ingredientLines,
		healthLabels: dat[i].healthLabels,
		calories: dat[i].calories,
		cuisine: dat[i].cuisineType,
		link: dat[i].url,
		tags: dat[i].tags,
	};
	obj['content']=[];
	res.render("card.ejs", {card: obj});
});

app.listen(3000, () => {
	console.log("server is up and listening on port 3000.");
});
