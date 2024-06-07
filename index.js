import express from "express";
import bodyParser from "body-parser";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from "pg";
import ejs from "ejs";
import axios from "axios";
import cookieParser from "cookie-parser";
import LlamaAI from "llamaai";

const app = express();
const port = 3000;

app.use(express.static("public"));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(cookieParser())

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

app.post('/login', async (req, res) => {
    const {username, password} = req.body;
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if(result.rows.length>0) {
        const user = result.rows[0];
        let validate = await bcrypt.compare(password, user.password);
        if(validate){
            const token = jwt.sign({ id: user.id, username: user.username }, process.env.SECRET_TOKEN, { expiresIn: '2h' });
            res.cookie('token', token, { httpOnly: true });
            msg = `You are logged in as ${username}`;
            res.redirect('/');
        } else {
            msg = "Wrong password. Try again.";
            res.redirect('/');
        }
    } else {
        msg = "You are not in our database. Try signing up for an account or re-login.";
        res.redirect('/');
    }

    //res.redirect('/login');
});

app.post('/signup', async (req, res) => {
    const {username, password} = req.body;
    if(req.body.repassword != req.body.password){
        res.render("signuppage.ejs", { wrning: "The password you re-entered does not match the new password." });
    }
    else {
        const hashed = await bcrypt.hash(password, 10);
        db.query('INSERT INTO users (username, password) VALUES ($1, $2);', [username, hashed], (err, rep) => {
            if(err){
                res.render("loginpage.ejs", {alert: "You already have an account with us."});
            } else {
                res.redirect('/logindirect');
            }
        });
    }
        
})

app.post("/logout", (req, res) => {
    res.clearCookie('token');
    msg = "You have been logged out."; 
    res.redirect('/');
    
})

const authenticate = function auth (req, res, next) {
    console.log(req.cookies);
    const token = req.cookies.token;
    if (typeof(token) == undefined) return res.redirect('/login');

    jwt.verify(token, SECRET_TOKEN, (err, user) => {
        if (err) return res.redirect('/login');
        req.user = user;
        next();
    })
};


//paste

const llamaAPI = new LlamaAI(process.env.API_KEY);

app.get("/recommend", async (req, res) => {
    
    const info = req.query.info;
    const apiRequestJson = {
    "messages": [
        {"role": "user", "content": info},
    ],
    "functions": [
        {
            "name": "suggest_improvement",
            "description": "Based on the recipe that the user created, suggest improvements in nutritional quality, ingredients used as well as measurements to enhance the taste of the dish.",
            "parameters": {
                "type": "object",
                "properties": {
                    "additional_ingredients": {
                        "type": "string",
                        "description": "Some additions to the recipe which can enhance its taste and nutrition.",
                    },
                    "final_recipe": {
                        "type": "string",
                        "description": "A description of the updated recipe with the extra ingredients.",
                    },
                    
                },
            },
            "required": ["properties", "final_recipe"],
        }
    ],
    "stream": false,
    "function_call": "suggest_improvement",
   };
   try {
        const response = await llamaAPI.run(apiRequestJson);
        console.log(response.choices[0].message.function_call.arguments);
        res.render("rec.ejs", { msg: response.choices[0].message.function_call });
    } catch (error) {
        console.error(error);
        res.render("index.ejs", { msg: "exception caught!" });
    }
})

app.get("/profile", (req, res) => {
    res.render("profile.ejs");
})

app.get('/signupdirect', (req, res) => {
    res.render("signuppage.ejs");
});

app.get("/", (req, res) => {
    res.render("index.ejs", {msg: msg});
});

app.get("/logindirect", (req, res) => {
    res.render("loginpage.ejs");
});

app.get("/random", (req, res) => {

})

app.get("/search", (req, res) => {

})

app.listen(3000, () => {
    console.log('server is up and listening on port 3000.')
});
