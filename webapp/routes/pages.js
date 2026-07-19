"use strict";

import { Router } from "express";

const router = Router();

router.get("/", (req, res) => res.render("elvora", { title: "Elvora" }));
router.get("/landing", (req, res) => res.render("landing", { title: "Landing" }));
router.get("/syncx", (req, res) => res.render("syncx", { title: "SyncX" }));
router.get("/colour", (req, res) => res.render("colour", { title: "Colour" }));
router.get("/elvora", (req, res) => res.render("elvora", { title: "Elvora" }));
router.get("/overview", (req, res) => res.render("overview", { title: "Overview" }));
router.get("/kpi", (req, res) => res.render("kpi", { title: "KPI" }));
router.get("/transactions", (req, res) => res.render("transactions", { title: "Transactions" }));
router.get("/automation", (req, res) => res.render("automation", { title: "Automation" }));
router.get("/visualizations", (req, res) => res.render("visualizations", { title: "Visualisations" }));
router.get("/finance", (req, res) => res.render("finance", { title: "Finance" }));
router.get("/finance-centre", (req, res) => res.render("finance-centre", { title: "Finance Centre" }));
router.get("/products", (req, res) => res.render("products", { title: "Products" }));

router.get("/home", (req, res) => res.redirect("/"));
router.get("/syncx-landing", (req, res) => res.redirect("/syncx"));

export default router;