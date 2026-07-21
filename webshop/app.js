const express = require("express");
const session = require("express-session");
const products = require("./data/products");

const app = express();

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
    session({
        secret: "shop-secret",
        resave: false,
        saveUninitialized: true
    })
);

// Initialise basket
app.use((req, res, next) => {

    if (!req.session.basket) {
        req.session.basket = [];
    }

    next();

});

// ==========================
// HOME
// ==========================

app.get("/", (req, res) => {

    const basketSize = req.session.basket.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    res.render("index", {
        products,
        basketSize
    });

});

// ==========================
// PRODUCT PAGE
// ==========================

app.get("/product/:id", (req, res) => {

    const product = products.find(
        p => p.id == req.params.id
    );

    if (!product) {
        return res.send("Product not found");
    }

    const basketSize = req.session.basket.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    res.render("product", {
        product,
        basketSize
    });

});

// ==========================
// ADD TO BASKET
// ==========================

app.post("/basket/add/:id", (req, res) => {

    const product = products.find(
        p => p.id == req.params.id
    );

    if (!product) {
        return res.redirect("/");
    }

    const existingItem = req.session.basket.find(
        item => item.product.id === product.id
    );

    if (existingItem) {

        existingItem.quantity++;

    } else {

        req.session.basket.push({

            product,
            quantity: 1

        });

    }

    res.redirect("/basket");

});

// ==========================
// INCREASE QUANTITY
// ==========================

app.post("/basket/increase/:id", (req, res) => {

    const item = req.session.basket.find(
        item => item.product.id == req.params.id
    );

    if (item) {
        item.quantity++;
    }

    res.redirect("/basket");

});

// ==========================
// DECREASE QUANTITY
// ==========================

app.post("/basket/decrease/:id", (req, res) => {

    const item = req.session.basket.find(
        item => item.product.id == req.params.id
    );

    if (!item) {
        return res.redirect("/basket");
    }

    item.quantity--;

    if (item.quantity <= 0) {

        req.session.basket = req.session.basket.filter(
            basketItem => basketItem.product.id != req.params.id
        );

    }

    res.redirect("/basket");

});

// ==========================
// REMOVE ITEM
// ==========================

app.post("/basket/remove/:id", (req, res) => {

    req.session.basket = req.session.basket.filter(
        item => item.product.id != req.params.id
    );

    res.redirect("/basket");

});

// ==========================
// VIEW BASKET
// ==========================

app.get("/basket", (req, res) => {

    let subtotal = 0;

    req.session.basket.forEach(item => {

        subtotal += item.product.price * item.quantity;

    });

    const shipping = subtotal > 200 ? 0 : 10;

    const vat = subtotal * 0.20;

    const total = subtotal + shipping + vat;

    const basketSize = req.session.basket.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    res.render("basket", {

        basket: req.session.basket,

        subtotal,

        shipping,

        vat,

        total,

        basketSize

    });

});

// ==========================
// START SERVER
// ==========================

const PORT = process.env.SHOP_PORT || 4000;

app.listen(PORT, () => {

    console.log("====================================");
    console.log(" Webshop running");
    console.log(` http://localhost:${PORT}`);
    console.log("====================================");

});