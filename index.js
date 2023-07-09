const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt =  require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');


//MidleWare
app.use(express.json())
app.use(cors())


function verifyJWT (req, res, next){
    const authHeader = req.headers.authorization
    if(!authHeader){
        return res.status(401).send('UnAuthoriged Access')
    }

    const token = authHeader.split(' ')[1];
    // console.log(token, authHeader);

    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            // console.log(err);
            return res.status(403).send({message: 'Forbidden Access'})
        }
        req.decoded = decoded;
        next();
    })
}


function sendBookingEmail(booking){
    const {email, treatment, appointmentDate, slot} = booking;
    
    // let transporter = nodemailer.createTransport({
    //     host: 'smtp.sendgrid.net',
    //     port: 587,
    //     auth: {
    //         user: "apikey",
    //         pass: process.env.SENDGRID_API_KEY
    //     }
    //  })

    const auth = {
        auth: {
          api_key: process.env.EMAIL_SEND_KEY,
          domain: process.env.EMAIL_SEND_DOMAIN
        }
      }
      
      const transporter = nodemailer.createTransport(mg(auth));

     transporter.sendMail({
        from: "nazmulbhuyian000@gmail.com", // verified sender email
        to: email, // recipient email
        subject: `Your appointment for ${treatment} is confirm`, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h3>Your appointment is confirm</h3>
        <div>
        <p>Please visit us on ${appointmentDate} on ${slot}</p>
        <p>Thanks from doctor portal</p>
        </div>
        `, // html body
      }, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.p8qnexq.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function run(){
    try{
        const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions')
        const bookingsCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')
        const doctorsCollection = client.db('doctorsPortal').collection('doctors')
        const paymentsCollection = client.db('doctorsPortal').collection('payments')

        const verifyAdmin = async(req, res, next) =>{
            // console.log(req.decoded.email);

            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail}
            const user = await usersCollection.findOne(query);

            if(user?.role !== 'admin'){
                return res.status(403).send({message: 'Forbidden Access'})
            }
            next()
        }

        app.get('/appointmentOptions', async(req, res) =>{
            const date = req.query.date;
            // console.log(date);
            const query = {}
            const options = await appointmentOptionsCollection.find(query).toArray();
            const bookingQuery = {appointmentDate: date}
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option =>{
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options)
        })

        app.get('/appointmentSpecialty', async(req, res) =>{
            const query = {}
            const result = await appointmentOptionsCollection.find(query).project({name: 1}).toArray();
            res.send(result)
        })


        app.post('/bookings', async(req, res) =>{
            const booking = req.body;
            // console.log(booking);

            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray();
            // console.log(alreadyBooked);
            if(alreadyBooked.length >= 1){
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({acknowledge: false, message})
            }

            const result= await bookingsCollection.insertOne(booking);

            // send email about appointment confirmation
            sendBookingEmail(booking)
            
            res.send({acknowledge: true, message: `You booking is successful on ${booking.appointmentDate}`})
            
        })

        app.get('/bookings', verifyJWT, async(req, res) =>{
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if(decodedEmail !== email){
                return res.status(403).send({message: 'Forbidden Access'})
            }

            const query = {email: email};
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })

        app.get('/bookings/:id', async(req, res) =>{
            const id = req.params.id;
            const query = {_id: ObjectId(id)}
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        })

        app.post('/users', async(req, res) =>{
            const user = req.body;
            const inserted = await usersCollection.findOne({email: user.email})
            if(inserted){
                return res.send({message: 'Previously Added'})
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        app.get('/users', async(req, res) =>{
            const query = {}
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res) =>{
            // const decodedEmail = req.decoded.email;
            // const query = {email: decodedEmail}
            // const user = await usersCollection.findOne(query);

            // if(user?.role !== 'admin'){
            //     return res.status(403).send({message: 'Forbidden Access'})
            // }

            const id = req.params.id
            // console.log(id);
            const filter = {_id: ObjectId(id)}
            const options = {upsert: true}
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne( filter,  updateDoc, options)
            res.send(result);
        })

        //Update temporary

        // app.get('/addPrice', async(req, res) =>{
        //     const filter = {}
        //     const options = {upsert: true}
        //     const updateDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionsCollection.updateMany( filter,  updateDoc, options)
        //     res.send(result);
        // })


        app.get('/users/admin/:email', async(req, res) =>{
            const email = req.params.email;
            const query = {email}
            const user = await usersCollection.findOne(query)
            res.send({isAdmin: user?.role === 'admin'})
        })

        app.get('/jwt', async(req, res) =>{
            const email = req.query.email;
            const query = {email: email}
            const user = await usersCollection.findOne(query);
            if(user){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN) //, {expiresIn: '1h'}
                // console.log(token);
                return res.send({accessToken: token})
            }
            res.status(403).send({accessToken: ''})
        })

        app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) =>{
            const doctors = req.body;
            // console.log(doctors);
            const result = await doctorsCollection.insertOne(doctors);
            res.send(result);
        })

        app.get('/doctors', verifyJWT, verifyAdmin, async(req, res) =>{
            const query = {}
            const doctors = await doctorsCollection.find(query).toArray()
            res.send(doctors);
        })

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async(req, res) =>{
            const id = req.params.id;
            const filter = {_id:  ObjectId(id)}
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })


        app.post('/create-payment-intent', async(req, res) =>{
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": [
                "card"
            ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        })

        app.post('/payments', async(req, res) =>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)}
            const updateDoc = {
                $set: {
                    paid: true,
                    transctionId: payment.transctionId
                }
            }
            const updateResult = await bookingsCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

    }

    finally{

    }
}

run().catch(console.log)


app.get('/', (req, res) =>{
    res.send('Doctor portal server is running')
})

app.listen(port, () =>{
    console.log(`Doctor portal is running on ${port}`);
})