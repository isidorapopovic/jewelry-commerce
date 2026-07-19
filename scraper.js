const axios = require("axios");
const cheerio = require("cheerio");
const db = require("./database");


const url =
    "https://www.tomade.com/i/925-sterling-silver-cubic-zirconia-flower-dainty-stud-earring/1000512143";



async function scrapeProduct() {


    try {


        const response = await axios.get(url, {

            headers: {
                "User-Agent":
                    "Mozilla/5.0"
            }

        });


        const html = response.data;


        const $ = cheerio.load(html);



        let product = {


            title:
                $("h1").text().trim(),


            description:
                $("meta[name='description']")
                    .attr("content"),



            image_url:
                $("img")
                    .first()
                    .attr("src"),



            price:
                null,


            old_price:
                null,


            discount:
                null,


            category:
                "Jewellery",


            availability:
                "In stock"



        };



        // Find prices
        $("body *").each((i, el) => {


            let text = $(el)
                .text()
                .trim();



            if (text.includes("$")) {

                let match = text.match(/\$([\d.]+)/);


                if (match) {

                    product.price =
                        parseFloat(match[1]);

                }


            }



        });



        console.log(product);



        // insert into Neon

        await db.query(

            `
INSERT INTO products
(
source_url,
title,
description,
price,
old_price,
discount,
image_url,
category,
availability
)

VALUES
($1,$2,$3,$4,$5,$6,$7,$8,$9)

ON CONFLICT(source_url)
DO UPDATE SET

price = EXCLUDED.price,
scraped_at = CURRENT_TIMESTAMP

`,

            [

                url,

                product.title,

                product.description,

                product.price,

                product.old_price,

                product.discount,

                product.image_url,

                product.category,

                product.availability

            ]


        );



        console.log("Saved to database");


    }

    catch (error) {

        console.log(error.message);

    }


}



scrapeProduct();