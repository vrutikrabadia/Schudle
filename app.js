//Importing
require('dotenv').config()
const express = require('express');
const mongoose = require('mongoose');
const _ = require('lodash');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const {google} = require('googleapis');
const credentials = require('./credentials.json');
const fs = require('fs');
const {file} = require('googleapis/build/src/apis/file');
const mime = require('mime-types');
const { create, uniq, forEach } = require('lodash');
const uniqid = require('uniqid');

const algorithm = 'aes-256-ctr';
const secretKey = process.env.SECRETKEY; // length must be 32.
const iv = crypto.randomBytes(16);



// drive configuration 
const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
];
const {
    client_id,
    client_secret,
    redirect_uris
} = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]);

const encrypt = (text) => {
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return {
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    };
};

const decrypt = (hash) => {
    const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(hash.iv, 'hex'));
    const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash.content, 'hex')), decipher.final()]);
    return decrpyted.toString();
};

//express app
const app = express();


//app use
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');


//Creating database
const db = mongoose.connect('mongodb://localhost:27017/schudle', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});
mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);


//Session prperties
app.use(session({
    secret: process.env.SECRETKEY,
    resave: false,
    saveUninitialized: true
}));


//Initializing assport with session
app.use(passport.initialize());
app.use(passport.session());


//Creating Schema

const reviewSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: Number,
    message: String,
})

const courseItemSubmission = new mongoose.Schema({
    subType: {
        type: String,
        enum: ['drive', 'link'],
    },
    name: String,
    studentid: String,
    googleid: String,
    extension: String,
    link: String,
})

const courseItemSchema = new mongoose.Schema({
    contentType: {
        type: String,
        enum: ['content', 'assignment'],
        default: 'content'
    },
    name: String,
    google_id: String,
    extension: String,
    deadline: Date,
    submissions: [courseItemSubmission],
    drivefolderid: String,
})

const eventSchema = new mongoose.Schema({
    summary: String,
    description: String,
    start : Date,
    googleid : String,
    courses: [],
    general: String,
    eventlink: String,
    meetlink: String
})

const courseSchema = new mongoose.Schema({
    schoolid: String,
    coursename: String,
    course_username: String,
    professorid: [],
    studentid: [],
    email: [],
    items: [courseItemSchema],
    event: [eventSchema],
    drivefolderid: String,
});

const schoolSchema = new mongoose.Schema({
    schoolname: String,
    schoolemail: String,
    adminusername: String,
    shortname: String,
    studentid: [],
    professorid: [],
    courses: [],
    events: [eventSchema],
    googletoken: String,
});

const userSchema = new mongoose.Schema({
    username: String,
    firstname: String,
    lastname: String,
    schoolname: String,
    schoolshort: String,
    email: String,
    address: String,
    phone: String,
    profileimg:{
            data: Buffer,
            contentType: String
    },
    role: {
        type: String,
        enum: ['professor', 'admin', 'student'],
        default: 'student'
    },
    courses: [],
});


//Attach passport to userSchema
userSchema.plugin(passportLocalMongoose);


//Creating Collection
const School = new mongoose.model('School', schoolSchema);
const User = new mongoose.model('User', userSchema);
const Course = new mongoose.model('Course', courseSchema);
const Review = new mongoose.model('Review', reviewSchema);


//Creating Strategy for Authentication
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

//Creating Transporter for NodeMailr
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL, // generated ethereal user
        pass: process.env.PASSWORD, // generated ethereal password
    },
});

// setting up multer
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "./public/"); //here we specify the destination. in this case i specified the current directory
    },
    filename: function (req, file, cb) {
        console.log(file); //log the file object info in console
        cb(null, file.originalname); //here we specify the file saving name. in this case. 
        //i specified the original file name .you can modify this name to anything you want
    }
});

var uploadDisk = multer({
    storage: storage
});

//Routes

//Home route
app.get("/", function (req, res) {
    res.render("homepage");
});

app.post("/", function (req, res) {
    var button = req.body.button;
    if (button == 'review') {
        const review = new Review({
            name: req.body.name,
            email: req.body.email,
            phone: req.body.number,
            message: req.body.message,
        });
        review.save(function () {
            res.redirect('/');
        })
    }
});

//Register route
app.get("/register", function (req, res) {
    res.render("register");
});

app.post("/register", function (req, res) {
    var schoolname = _.startCase(req.body.schoolname);
    var shortname = _.lowerCase(req.body.shortname);
    var schoolemail = req.body.schoolemail;
    var adminusername = req.body.adminusername;
    var adminfirstname = _.capitalize(req.body.adminfirstname);
    var adminlastname = _.capitalize(req.body.adminlastname);

    const school = new School({
        schoolname: schoolname,
        shortname: shortname,
        schoolemail: schoolemail,
        adminusername: adminusername,

    })

    User.register({
        username: adminusername,
        firstname: adminfirstname,
        lastname: adminlastname,
        schoolname: schoolname,
        email: schoolemail,
        role: "admin",
        schoolshort: shortname,
        profileimg: {
            data: fs.readFileSync(path.join(__dirname + '/public/images/default_profile.png' )),
            contentType: 'image/png'
        }
    }, req.body.password, function (err) {
        if (err) {
            console.log(err);
            res.send({
                message: "admin not saved"
            });
        } else {
            school.save(function (err) {
                if (err) {
                    console.log(err);
                    res.send({
                        message: "school not saved"
                    });
                } else {
                    res.send({
                        message: "all saved"
                    });
                }
            });
        }
    })
})

app.post("/register-validation", function (req, res) {
    var val = req.body.val;
    if (val == "schoolname") {
        School.findOne({
            schoolname: _.capitalize(req.body.data.trim()),
        }, function (err, f) {
            if (err) console.log(err);
            else {
                if (f) {
                    res.send({
                        message: "taken"
                    });
                } else {
                    res.send({
                        message: "not taken"
                    });
                }
            }
        })
    }
    if (val == "schoolemail") {
        School.findOne({
            schoolemail: req.body.data.trim()
        }, function (err, f) {
            if (err) console.log(err);
            else {
                if (f) {
                    res.send({
                        message: "taken"
                    });
                } else {
                    res.send({
                        message: "not taken"
                    });
                }
            }
        })
    }
    if (val == "shortname") {
        School.findOne({
            shortname: _.lowerCase(req.body.data.trim()),
        }, function (err, f) {
            if (err) console.log(err);
            else {
                if (f) {
                    res.send({
                        message: "taken"
                    });
                } else {
                    res.send({
                        message: "not taken"
                    });
                }
            }
        })
    }
    if (val == "adminusername") {

        User.findOne({
            username: req.body.data.trim()
        }, function (err, f) {
            if (err) console.log(err);
            else {
                if (f) {
                    res.send({
                        message: "taken"
                    });
                } else {
                    res.send({
                        message: "not taken"
                    });
                }
            }
        })
    }
});

//Custom School login/logout route
app.get("/:schoolname", function (req, res) {
    var shortname = req.params.schoolname;

    School.findOne({
        shortname: shortname
    }, function (err, found) {

        if (!found) {
            res.render("error404");
        } else {
            res.render("login", {
                schoolname: found.schoolname,
                shortname: shortname,
            });
        }
    })
});

app.post("/:schoolname", function (req, res) {
    const username = req.body.username;
    const schoolname = req.params.schoolname;
    const button = req.body.button;

    if (button == "login") {
        User.findOne({
            username: username
        }, function (err, found) {
            if (!found) {

                res.send({
                    message: "User not found"
                })
            } else {
                if (found.schoolshort == schoolname) {
                    const user = new User({
                        username: username,
                        password: req.body.password
                    })
                    req.login(user, function (err) {
                        if (err) {
                            console.log(err);
                            res.send({
                                message: "Bad Credentials"
                            })
                        } else {
                            passport.authenticate("local", function (err, user, info) {
                                if (info) {
                                    req.session.destroy();
                                    res.send({
                                        message: "Bad Credentials"
                                    })
                                } else {
                                    if (found.role === "admin") {
                                        res.send({
                                            message: "admin"
                                        })
                                    } else if (found.role === "professor") {
                                        res.send({
                                            message: "professor"
                                        })
                                    } else if (found.role === "student") {
                                        res.send({
                                            message: "student"
                                        })
                                    }
                                };
                            })(req, res, function () {});
                        }
                    })
                } else {
                    res.send({
                        message: "User not found"
                    })
                }
            }
        })
    }
    if (button == "logout") {
        req.logout();
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/forgot-password", function (req, res) {
    const shortname = req.params.schoolname;
    const username = req.body.username;
    const userEmail = req.body.email;

    User.findOne({
        username: username,
        schoolshort: shortname,
    }, function (err, found) {
        if (found) {
            time = (Date.now() + 900000).toString();
            linkString = shortname + "-" + userEmail + "-" + username + "-" + time;
            hasedLink = encrypt(linkString);
            token = hasedLink.iv + "-" + hasedLink.content;

            var mailOptions = {
                from: process.env.EMAIL,
                to: userEmail,
                subject: 'Forgot Password',

                html: '<p>Click <a href="http://localhost:3000/recover-password/' + token + '">here</a> to reset your password</p>'
            };

            transporter.sendMail(mailOptions, function (err, info) {
                if (err) {
                    console.log(err);
                }
                res.send({
                    message: "Link sent",
                });
            })
        } else {
            res.send({
                message: "User not enrolled",
            });
        }

    })
})

//Password Recovery route
app.get("/recover-password/:token", function (req, res) {

    const token = req.params.token;
    const haseString = token.toString().split("-");
    const hase = {
        iv: haseString[0].toString(),
        content: haseString[1].toString()
    }
    const linkString = decrypt(hase).split("-");
    const shortname = linkString[0];
    const username = linkString[2];
    const time = linkString[3];

    if (time > Date.now()) {
        User.findOne({
            username: username,
            schoolshort: shortname,
        }, function (err, user) {
            if (user) {
                res.render("recover-password", {
                    token: token,
                });
            } else {
                res.render('error404')
            }
        })
    } else {
        res.render('error404')
    }
})

app.post("/recover-password/:token", function (req, res) {

    const token = req.params.token;
    const haseString = token.toString().split("-");
    const hase = {
        iv: haseString[0].toString(),
        content: haseString[1].toString()
    }
    const linkString = decrypt(hase).split("-");
    const shortname = linkString[0];
    const username = linkString[2];
    const time = linkString[3];
    if (time > Date.now()) {
        User.findOne({
            username: username,
            schoolshort: shortname,
        }, function (err, user) {
            if (user) {
                user.setPassword(req.body.password, function (err, updatedUser) {
                    if (err) {
                        console.log(err);
                    }
                    if (updatedUser) {
                        updatedUser.save(function (err) {
                            if (err) {
                                console.log(err);
                            }
                        });
                    }
                })
                user.save(function (err) {
                    if (err) {
                        console.log(err);
                    }
                });
                res.send({
                    message: 'saved',
                    schoolname: shortname,
                })
            } else {
                res.send({
                    message: 'user not found'
                })
            }
        })
    } else(
        res.send({
            message: 'Link expired',
        })
    )
})


//reset password route
app.get('/:schoolname/reset-password', function (req, res) {
    const schoolname = req.params.schoolname;

    if (req.isAuthenticated()) {
        res.render("reset_password", {
            message: "",
            school: req.params.schoolname
        });
    } else {
        res.redirect("/" + schoolname)
    }
})

app.post('/:schoolname/reset-password', function (req, res) {
    if (req.isAuthenticated()) {
        req.user.changePassword(req.body.curr_pass, req.body.new_pass, function (err) {
            if (err) {
                console.log(err);
                res.send({
                    message: 'current password incorrect',
                });
            } else {
                res.send({
                    message: 'saved',
                    schoolname: req.user.schoolshort,
                });
            }
        })
    } else {
        res.send({
            message: 'error404',
        });
    }
})

//Profiles
app.get("/:schoolname/profile", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.schoolshort == shortname) {
        if(req.user.role == "admin"){
            res.render('profile', {
                schoolname: req.user.schoolname,
                info: req.user,
                school: shortname,
                name: req.user.firstname + ' ' + req.user.lastname,
                message: ""
            });
        }else if(req.user.role == "professor"){
            Course.find({
                professorid: {
                    $in: [String(req.user._id)]
                }
            }, function (err, find) {
                res.render("profile", {
                    schoolname: req.user.schoolname,
                    info: req.user,
                    school: shortname,
                    message: "",
                    name: req.user.firstname + ' ' + req.user.lastname,
                    courses: find
                })
            }); 
        }else if(req.user.role == "student"){
            Course.find({
                studentid: {
                    $in: [String(req.user._id)]
                }
            }, function (err, find) {
                res.render("profile", {
                    schoolname: req.user.schoolname,
                    info: req.user,
                    school: shortname,
                    message: "",
                    name: req.user.firstname + ' ' + req.user.lastname,
                    courses: find
                })
            });
        }
        
    } else {
        res.redirect("/" + shortname);
    }

})

app.post("/:schoolname/profile", function(req,res){
    if(req.isAuthenticated()){
        User.findOne({_id: req.user._id},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                found.phone = req.body.phone;
                found.address = req.body.address;
                found.save(function(err){
                    if(err){
                        console.log(err);
                    }
                    res.redirect("/"+req.params.schoolname+"/profile")
                })
            }
        })
    }
    else{
        res.redirect("/"+req.params.schoolname);
    }
})



app.get("/:schoolname/profile/change_photo",function(req,res){
    if(req.isAuthenticated()){
    res.render("change_profile_pic",{school:req.params.schoolname});
    }
    else{
        res.redirect("/"+req.params.schoolname);
    }
})

app.post("/:schoolname/profile/change_photo", uploadDisk.single("file"), function (req, res) {
    
    if(req.isAuthenticated()){
        User.findOne({_id : req.user._id},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                found.profileimg= {
                    data: fs.readFileSync(path.join(__dirname + '/public/' + req.file.filename)),
                    contentType: req.file.mimetype,
                }
                found.save(function(err){
                    if(err){
                        console.log(err);
                    }
                    fs.unlink(__dirname + '/public/' + req.file.filename, (err) => {
                        if (err) {
                            console.error(err)
                        }
                        res.redirect("/"+req.params.schoolname+"/profile");
                    })
                    
                })
            }
        })
    }
    else{
        res.redirect("/"+req.params.schoolname);
    }
});

//Admin Dashboard route
app.get("/:schoolname/admin/dashboard", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        School.findOne({
            shortname: shortname
        }, function (err, find) {
            Course.find({
                schoolid: find._id
            }, function (err, found) {
                res.render("admin_dash", {
                    school: shortname,
                    courses: found,
                    no_student: find.studentid.length,
                    no_professor: find.professorid.length,
                    name: req.user.firstname + ' ' + req.user.lastname,
                    info: req.user,
                });
            })
        })
    } else {
        res.redirect("/" + shortname);
    }
})

//Professor Dashboard route
app.get("/:schoolname/professor/dashboard", function (req, res) {
    const schoolname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "professor" && req.user.schoolshort == schoolname) {
        Course.find({
            professorid: {
                $in: [String(req.user._id)]
            }
        }, function (err, find) {
            res.render("professor_dash", {
                name: req.user.firstname + ' ' + req.user.lastname,
                school: schoolname,
                courses: find,
                info: req.user
            })
        });
    } else {
        res.redirect("/" + schoolname);
    }
})


//Student Dashboard Route
app.get("/:schoolname/student/dashboard", function (req, res) {
    const schoolname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "student" && req.user.schoolshort == schoolname) {
        Course.find({
            studentid: {
                $in: [String(req.user._id)]
            }
        }, function (err, find) {
            res.render("student_dash", {
                name: req.user.firstname + ' ' + req.user.lastname,
                school: schoolname,
                courses: find,
                info: req.user
            })
        });
    } else {
        res.redirect("/" + schoolname);
    }
})


// Configuration of drive and calender



app.get("/:schoolname/admin/configure", function (req, res) {
    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == req.params.schoolname) {

        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
        });

        res.render("configure", {
            school: req.params.schoolname,
            url: authUrl
        });
    }
})


app.post("/:schoolname/admin/configure", function (req, res) {
    oAuth2Client.getToken(req.body.key, (err, token) => {
        if (err) return console.error('Error retrieving access token', err);

        School.findOne({
            shortname: req.params.schoolname
        }, function (err, found) {
            if (err) {
                console.log(err);
            }
            if (found) {
                // console.log(JSON.parse(decrypt(JSON.parse(JSON.stringify(encrypt(JSON.stringify(token)))))));
                found.googletoken = JSON.stringify(encrypt(JSON.stringify(token)));
                found.save(function (err) {
                    if (err) {
                        console.log(err);
                        res.redirect("/" + req.params.schoolname + "/admin/configure");
                    }
                    res.redirect("/" + req.params.schoolname + "/admin/dashboard");
                })
            } else {
                res.render('error404');
            }
        })

    });

})

function authorize(school, response, callback) {

    School.findOne({
        shortname: school
    }, function (err, found) {
        if (err) {
            console.log(err);
        }
        if (found) {
            oAuth2Client.setCredentials(JSON.parse(decrypt(JSON.parse(found.googletoken))));
            if (!(oAuth2Client.credentials.access_token)) {
                response.redirect("/" + school + "/contact_admin");
            }
            callback(oAuth2Client);
        }
    })

}

app.get("/:schoolname/contact_admin", function (req, res) {
    res.render("contact_admin");
})

//Creating Professor route
app.get("/:schoolname/admin/createprof", function (req, res) {
    const schoolname = req.params.schoolname;

    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        res.render("create_prof", {
            shortname: shortname,
        });
    } else {
        res.redirect("/" + shortname);
    }
})

app.post("/:schoolname/admin/createprof", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {

        if (req.body.button == 'validate') {

            if (req.body.val == 'username') {
                User.findOne({
                    username: req.body.data,
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'User already exist',
                        })
                    } else {
                        res.send({
                            message: 'User available',
                        })
                    }
                })
            }

            if (req.body.val == 'email') {
                User.findOne({
                    email: req.body.data,
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'User already exist',
                        })
                    } else {
                        res.send({
                            message: 'User available',
                        })
                    }
                })
            }

        }



        if (req.body.button == 'register') {
            const firstname = _.capitalize(req.body.firstname);
            const lastname = _.capitalize(req.body.lastname);
            const schoolname = req.user.schoolname;
            User.register({
                username: req.body.username,
                firstname: firstname,
                lastname: lastname,
                schoolname: schoolname,
                role: "professor",
                schoolshort: shortname,
                email: req.body.email,
                profileimg: {
                    data: fs.readFileSync(path.join(__dirname + '/public/images/default_profile.png' )),
                    contentType: 'image/png'
                },
            }, req.body.password, function (err, user) {
                if (err) {
                    console.log(err);
                    res.send({
                        message: 'User not saved',
                    })
                } else {
                    User.findOne({
                        username: req.body.username,
                    }, function (err, find) {
                        School.findOne({
                            shortname: shortname
                        }, function (err, founded) {
                            if (founded) {
                                founded.professorid.push(find._id)
                                founded.save(function () {
                                    res.send({
                                        message: 'User saved',
                                    })
                                });
                            }
                        })
                    })
                }
            })
        }
    } else {
        res.send({
            message: 'Uauthorised',
        })
    }
})

//Creating Student route
app.get("/:schoolname/admin/createstudent", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        res.render("create_student", {
            shortname: shortname,
        });
    } else {
        res.redirect("/" + shortname);
    }
})

app.post("/:schoolname/admin/createstudent", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        const button = req.body.button;

        if (button == 'validate') {
            if (req.body.val == 'username') {
                User.findOne({
                    username: req.body.data,
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'User already exist',
                        })
                    } else {
                        res.send({
                            message: 'User available',
                        })
                    }
                })
            }

            if (req.body.val == 'email') {
                User.findOne({
                    email: req.body.data,
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'User already exist',
                        })
                    } else {
                        res.send({
                            message: 'User available',
                        })
                    }
                })
            }
        }


        if (button == 'register') {
            const firstname = _.capitalize(req.body.firstname);
            const lastname = _.capitalize(req.body.lastname);
            const schoolname = req.user.schoolname;
            User.register({
                username: req.body.username,
                firstname: firstname,
                lastname: lastname,
                schoolname: schoolname,
                role: "student",
                schoolshort: shortname,
                email: req.body.email,
                profileimg: {
                    data: fs.readFileSync(path.join(__dirname + '/public/images/default_profile.png' )),
                    contentType: 'image/png'
                }
            }, req.body.password, function (err, user) {
                if (err) {
                    console.log(err);
                    res.send({
                        message: 'User not saved',
                    })
                } else {
                    User.findOne({
                        username: req.body.username,
                    }, function (err, find) {
                        School.findOne({
                            shortname: shortname
                        }, function (err, founded) {
                            if (founded) {
                                founded.studentid.push(find._id)
                                founded.save(function () {
                                    res.send({
                                        message: 'User saved',
                                    })
                                });
                            }
                        })
                    })
                }
            })
        }
    } else {
        res.send({
            message: 'Uauthorised',
        })
    }
})


//Creating course route
app.get("/:schoolname/admin/createcourse", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        res.render("create_course", {
            shortname: shortname,
        });
    } else {
        res.redirect("/" + shortname);
    }
})

app.post("/:schoolname/admin/createcourse-validation", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        const val = req.body.val;

        School.findOne({
            shortname: shortname
        }, function (err, find) {

            if (val == 'coursename') {
                Course.findOne({
                    schoolid: find._id,
                    coursename: _.capitalize(req.body.data),
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'taken',
                        })
                    } else {
                        res.send({
                            message: 'not taken',
                        })
                    }

                })
            }

            if (val == 'course_username') {
                Course.findOne({
                    schoolid: find._id,
                    course_username: _.upperCase(req.body.data),
                }, function (err, found) {
                    if (found) {
                        res.send({
                            message: 'taken',
                        })
                    } else {
                        res.send({
                            message: 'not taken',
                        })
                    }
                })
            }
        })
    } else {
        res.send({
            message: 'Uauthorised',
        })
    }
})

app.post("/:schoolname/admin/createcourse", function (req, res) {
    const shortname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == shortname) {
        const coursename = _.capitalize(req.body.coursename);
        const course_username = _.upperCase(req.body.course_username);

        School.findOne({
            shortname: shortname
        }, function (err, find) {
            authorize(req.params.schoolname, res, create_folder);

            function create_folder(auth) {
                const drive = google.drive({
                    version: "v3",
                    auth
                });

                var fileMetadata = {
                    'name': course_username,
                    'mimeType': 'application/vnd.google-apps.folder'
                };
                drive.files.create({
                    resource: fileMetadata,
                    fields: 'id'
                }, function (err, file) {
                    if (err) {
                        // Handle error
                        console.error(err);
                    } else {
                        // console.log('Folder Id: ', file.data.id);
                        let folder_id = file.data.id;
                        // console.log(typeof(file.data.id));
                        const newCourse = new Course({
                            coursename: coursename,
                            course_username: course_username,
                            schoolid: find._id,
                            drivefolderid: folder_id,
                        });

                        console.log(newCourse);

                        newCourse.save(function () {
                            Course.findOne({
                                schoolid: find._id,
                                coursename: coursename,
                            }, function (err, founded) {
                                find.courses.push(founded._id)
                                find.save(function () {
                                    res.send({
                                        message: "all saved",
                                    });
                                })
                            });
                        })
                    }
                });
            }


        })
    } else {
        res.send({
            message: 'Uauthorised',
        })
    }
})


//Custom Course route
app.get("/:schoolname/admin/courses/:coursename", function (req, res) {
    const schoolname = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        const coursename = req.params.coursename;

        School.findOne({
            shortname: schoolname
        }, function (err, find) {
            Course.findOne({
                coursename: coursename,
                schoolid: find._id
            }, function (err, found) {
                if (found) {
                    var professorid;
                    var studentid;

                    if (found.professorid) professorid = found.professorid;
                    if (found.studentid) studentid = found.studentid;

                    var allids = professorid.concat(studentid);

                    User.find({
                        _id: {
                            $in: allids
                        }
                    }, function (err, founded) {
                        var professors = [];
                        var students = [];


                        for (var i = 0; i < founded.length; i++) {
                            if (founded[i].role == "student") students.push(founded[i]);
                            if (founded[i].role == "professor") professors.push(founded[i]);
                        }
                        res.render("course", {
                            school: schoolname,
                            coursename: coursename,
                            name: req.user.firstname + " " + req.user.lastname,
                            professors: professors,
                            students: students,
                            info: req.user,
                        });
                    })
                } else {
                    res.render("error404");
                }
            })
        })
    } else {
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/admin/courses/:coursename", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        const button = req.body.button;

        if (button == "enrollstudent") {
            res.redirect("/" + schoolname + "/admin/courses/" + coursename + "/enrollstudent");
        }
        if (button == "assignprof") {
            res.redirect("/" + schoolname + "/admin/courses/" + coursename + "/assignprof");
        }
        if (button == "removeprof") {
            res.redirect("/" + schoolname + "/admin/courses/" + coursename + "/removeprof");
        }
        if (button == "removestudent") {
            res.redirect("/" + schoolname + "/admin/courses/" + coursename + "/removestudent");
        }
    } else {
        res.redirect("/" + schoolname);
    }
})

//Assigning Professor route
app.get("/:schoolname/admin/courses/:coursename/assignprof", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        School.findOne({
            shortname: schoolname
        }, function (err, found) {

            Course.findOne({
                coursename: coursename,
                schoolid: found._id
            }, function (err, find) {
                if (find) {
                    var a = found.professorid;
                    var b = find.professorid;

                    var professorsid = a.filter(x => !b.includes(x));

                    User.find({
                        _id: {
                            $in: professorsid
                        }
                    }, function (err, founded) {
                        var professors = []
                        for (var i = 0; i < founded.length; i++) {
                            professors.push(founded[i]);
                        }

                        res.render("assign_prof", {
                            school: schoolname,
                            coursename: coursename,
                            professors: professors,
                            info: req.user,
                            name: req.user.firstname + ' ' + req.user.lastname,
                            message: ""
                        });
                    })

                } else {
                    res.render("error404");
                }
            })
        })

    } else {
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/admin/courses/:coursename/assignprof", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        var professors = req.body.profname;

        if (typeof professors == "string") {
            professors = [];
            professors.push(req.body.profname)
        }

        School.findOne({
            shortname: schoolname
        }, function (err, find) {
            Course.findOne({
                coursename: coursename,
                schoolid: find._id
            }, function (err, found) {

                for (var i = 0; i < professors.length; i++) {
                    var prof = professors[i].split(" ");

                    found.professorid.push(prof[0]);
                    found.email.push(prof[1])
                    User.findOne({
                        _id: prof[0],
                    }, function (err, user) {
                        user.courses.push(found._id);
                        user.save(function () {});
                    })
                }
                found.save(function () {
                    res.redirect("/" + schoolname + "/admin/courses/" + coursename);
                })
            })
        })
    } else {
        res.redirect("/" + schoolname);
    }
})

//dismiss Professor route
app.get("/:schoolname/admin/courses/:coursename/removeprof", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        School.findOne({
            shortname: schoolname
        }, function (err, found) {

            Course.findOne({
                coursename: coursename,
                schoolid: found._id
            }, function (err, find) {
                if (find) {

                    var professorsid = find.professorid;
                    User.find({
                        _id: {
                            $in: professorsid
                        }
                    }, function (err, founded) {
                        var professors = []
                        for (var i = 0; i < founded.length; i++) {
                            professors.push(founded[i]);
                        }

                        res.render("remove_prof", {
                            school: schoolname,
                            coursename: coursename,
                            professors: professors,
                            info: req.user,
                            name: req.user.firstname + ' ' + req.user.lastname,
                            message: ""
                        });
                    })

                } else {
                    res.render("error404");
                }
            })
        })

    } else {
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/admin/courses/:coursename/removeprof", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        var professors = req.body.profname;

        if (typeof professors == "string") {
            professors = [];
            professors.push(req.body.profname);
        }

        School.findOne({
            shortname: schoolname
        }, function (err, find) {

            for (var i = 0; i < professors.length; i++) {
                var prof = professors[i].split(" ");

                Course.findOneAndUpdate({
                    coursename: coursename,
                    schoolid: find._id
                }, {
                    $pull: {
                        professorid: prof[0],
                        email: prof[1],
                    }
                }, function (err, founded) {
                    User.findOneAndUpdate({
                        _id: prof[0],
                    }, {
                        $pull: {
                            courses: {
                                $in: founded._id
                            }
                        }
                    }, function (err, found) {});
                });
            }
            res.redirect("/" + schoolname + "/admin/courses/" + coursename);
        })
    } else {
        res.redirect("/" + schoolname);
    }
})


//Enrolling Student route
app.get("/:schoolname/admin/courses/:coursename/enrollstudent", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        School.findOne({
            shortname: schoolname
        }, function (err, found) {

            Course.findOne({
                coursename: coursename,
                schoolid: found._id
            }, function (err, find) {
                if (find) {
                    var a = found.studentid;
                    var b = find.studentid;

                    var studentid = a.filter(x => !b.includes(x));

                    User.find({
                        _id: {
                            $in: studentid
                        }
                    }, function (err, founded) {
                        var students = []
                        for (var i = 0; i < founded.length; i++) {
                            students.push(founded[i]);
                        }

                        res.render("enroll_student", {
                            school: schoolname,
                            coursename: coursename,
                            students: students,
                            info: req.user,
                            name: req.user.firstname + ' ' + req.user.lastname,
                            message: ""
                        });
                    })

                } else {
                    res.render("error404");
                }
            })
        })

    } else {
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/admin/courses/:coursename/enrollstudent", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        var students = req.body.studentname;

        if (typeof students == "string") {
            students = [];
            students.push(req.body.studentname)
        }
        School.findOne({
            shortname: schoolname
        }, function (err, find) {
            Course.findOne({
                coursename: coursename,
                schoolid: find._id
            }, function (err, found) {

                for (var i = 0; i < students.length; i++) {
                    var student = students[i].split(" ");

                    found.studentid.push(student[0])
                    found.email.push(student[1]);
                    User.findOne({
                        _id: student[0],
                    }, function (err, user) {
                        user.courses.push(found._id);
                        user.save(function () {});
                    })
                }
                found.save(function () {
                    res.redirect("/" + schoolname + "/admin/courses/" + coursename);
                })
            })
        })
    } else {
        res.redirect("/" + schoolname);
    }
})

//dismiss Student route
app.get("/:schoolname/admin/courses/:coursename/removestudent", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        School.findOne({
            shortname: schoolname
        }, function (err, found) {

            Course.findOne({
                coursename: coursename,
                schoolid: found._id
            }, function (err, find) {
                if (find) {
                    var studentid = find.studentid;

                    User.find({
                        _id: {
                            $in: studentid
                        }
                    }, function (err, founded) {
                        var students = []
                        for (var i = 0; i < founded.length; i++) {
                            students.push(founded[i]);
                        }

                        res.render("remove_student", {
                            school: schoolname,
                            coursename: coursename,
                            students: students,
                            info: req.user,
                            name: req.user.firstname + ' ' + req.user.lastname,
                            message: ""
                        });
                    });

                } else {
                    res.render("error404");
                };
            });
        });

    } else {
        res.redirect("/" + schoolname);
    }
})

app.post("/:schoolname/admin/courses/:coursename/removestudent", function (req, res) {
    const schoolname = req.params.schoolname;
    const coursename = req.params.coursename;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolname) {
        var students = req.body.studentname;

        if (typeof students == "string") {
            students = [];
            students.push(req.body.studentname)
        }
        School.findOne({
            shortname: schoolname
        }, function (err, find) {
            for (var i = 0; i < students.length; i++) {
                var student = students[i].split(" ");

                Course.findOneAndUpdate({
                    coursename: coursename,
                    schoolid: find._id
                }, {
                    $pull: {
                        studentid: student[0],
                        email: student[1],
                    }
                }, function (err, founded) {
                    User.findOneAndUpdate({
                        _id: student[0]
                    }, {
                        $pull: {
                            courses: {
                                $in: founded._id
                            }
                        }
                    }, function (err, found) {});
                });
            };
            res.redirect("/" + schoolname + "/admin/courses/" + coursename);
        });
    } else {
        res.redirect("/" + schoolname);
    };
})

//Remove user from school
app.get('/:schoolname/admin/deleteUser', function (req, res) {
    const schoolshort = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolshort) {
        School.findOne({
            shortname: schoolshort
        }, function (err, school) {
            if (school) {

                var UserArray = school.studentid.concat(school.professorid)
                User.find({
                    _id: {
                        $in: UserArray
                    }
                }, function (err, found) {
                    var users = found;

                    res.render("delete_user", {
                        school: schoolshort,
                        users: users,
                        message: ""
                    });
                })
            }
        })
    } else {
        res.redirect("/" + schoolshort);
    }
})

app.post('/:schoolname/admin/deleteUser', function (req, res) {
    const schoolshort = req.params.schoolname;

    if (req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == schoolshort) {
        students = req.body.student;
        professors = req.body.professor;

        if (typeof students == 'string') {
            students = [];
            students.push(req.body.student);
        }
        if (typeof professors == 'string') {
            professors = [];
            professors.push(req.body.professor);
        }

        var studentid = [];
        var studentObject = [];
        var studentemail = [];
        var professorid = [];
        var professorObject = [];
        var professoremail = [];

        if (students) {
            for (let i = 0; i < students.length; i++) {
                var student = students[i].split(" ");
                studentid.push(String(student[0]));
                studentObject.push(mongoose.Types.ObjectId(student[0]));
                studentemail.push(String(student[1]));
            }
            School.findOneAndUpdate({
                shortname: schoolshort
            }, {
                $pull: {
                    studentid: {
                        $in: studentObject
                    }
                }
            }, function (err, find) {
                if (err) {
                    console.log(err);
                }
                Course.updateMany({
                    schoolid: find._id
                }, {
                    $pull: {
                        studentid: {
                            $in: studentid
                        },
                        email: {
                            $in: studentemail
                        }
                    }
                }, function (err, updatedCourse) {
                    if (err) {
                        console.log(err);
                    }
                })
                studentid.forEach(function (user) {
                    User.findOneAndDelete({
                        _id: user,
                        schoolshort: schoolshort
                    }, function (err, deletedUser) {
                        if (err) {
                            console.log(err);
                        }
                    })
                })
            })
        }
        if (professors) {
            for (let i = 0; i < professors.length; i++) {
                var professor = professors[i].split(" ");
                professorid.push(String(professor[0]));
                professorObject.push(mongoose.Types.ObjectId(professor[0]));
                professoremail.push(String(professor[1]));
            }
            School.findOneAndUpdate({
                shortname: schoolshort
            }, {
                $pull: {
                    professorid: {
                        $in: professorObject
                    }
                }
            }, function (err, find) {
                if (err) {
                    console.log(err);
                }
                Course.updateMany({
                    schoolid: find._id
                }, {
                    $pull: {
                        professorid: {
                            $in: professorid
                        },
                        email: {
                            $in: professoremail
                        }
                    }
                }, function (err, updatedCourse) {
                    if (err) {
                        console.log(err);
                    }
                })
                professorid.forEach(function (user) {
                    User.findOneAndDelete({
                        _id: user,
                        schoolshort: schoolshort
                    }, function (err, deletedUser) {
                        if (err) {
                            console.log(err);
                        }
                    })
                })
            })
        }
        res.redirect("/" + schoolshort + "/admin/dashboard")
    } 
    else {
        res.redirect("/" + schoolshort);
    }
})

// open course page
app.get('/:schoolname/:course_id', function (req, res) {
    Course.findOne({
        _id: req.params.course_id
    }, function (err, found) {
        if (found) {
            var professorid;
            var studentid;
            if (found.professorid) professorid = found.professorid;
            if (found.studentid) studentid = found.studentid;

            var allids = professorid.concat(studentid);


            User.find({
                _id: {
                    $in: allids
                }
            }, function (err, founded) {
                var professors = [];
                var students = [];
                for (var i = 0; i < founded.length; i++) {
                    if (founded[i].role == "student") students.push(founded[i].username);
                    if (founded[i].role == "professor") professors.push(founded[i].username);
                }
                if (req.user.role == "professor") {
                    res.render("course_page_prof", {
                        school: req.params.schoolname,
                        found: found,
                        students: students,
                        professors: professors,
                        courseid: req.params.course_id
                    });
                } else if (req.user.role == "student") {
                    res.render("course_page_stud", {
                        school: req.params.schoolname,
                        found: found,
                        students: students,
                        professors: professors,
                        courseid: req.params.course_id,
                        user:req.user,
                    });
                }
            })

        } else {
            console.log("not found");
        }
        if (err) {
            console.log(err);
        }
    })
})

// view submissions

app.get("/:schoolname/:courseid/:itemid/viewsubmission",function(req,res){
    if(req.isAuthenticated() && req.user.role == "professor"){
        Course.findOne({_id: req.params.courseid}, function(err, found){
            if(err){
                console.log(err);
            }
            else{
                // console.log(found);
                for(var i=0; i<found.items.length; i++){
                    if(found.items[i]._id==req.params.itemid){
                        res.render("view_submission",{item:found.items[i], school: req.params.schoolname, courseid: req.params.courseid});
                    }
                }
            }
        })
    }
})

// submit assignment
app.get("/:schoolname/:courseid/:itemid/submitassignment",function(req,res){
    if(req.isAuthenticated() && req.user.role == "student"){
        res.render("add_submission", {
            schoolname: req.params.schoolname,
            courseid: req.params.courseid,
            itemid: req.params.itemid,
        });
    }
})

app.post("/:schoolname/:courseid/:itemid/submitassignment",uploadDisk.single("file"),function(req,res){
    if(req.isAuthenticated() && req.user.role == "student"){
        // console.log(req.body);
        Course.findOne({_id:req.params.courseid}, function(err,found){
            if(err){
                console.log(err);
            }
            else{
                found.items.forEach(function(item){
                    if(item._id == req.params.itemid){
                        if(req.body.subType=="link"){
                            // console.log("inside link")
                            item.submissions.push({
                                subType: req.body.subType,
                                name: req.user.username + "_" +item.name,
                                studentid: req.user._id,
                                link: req.body.link,
                            })
                            found.save(function (err) {
                                if (!err) {
                                    res.redirect("/" + req.params.schoolname + "/" + req.params.courseid);
                                }
                                console.log(err);
                            })

                        }
                        else if(req.body.subType=="drive" ){
                            var fileMetadata = {
                                name:  req.user.username + "_" +item.name, // file name that will be saved in google drive
                                parents: [item.drivefolderid]
                            };
                            var media = {
                                mimeType: req.file.mimetype,
                                body: fs.createReadStream(req.file.destination + '/' + req.file.filename), // Reading the file from our server
                            };
                            authorize(req.params.schoolname, res, create_submission);
                            
                            function create_submission(auth){
                                // console.log("authorized");
                                const drive = google.drive({
                                    version: "v3",
                                    auth
                                });
                                drive.files.create({
                                    resource: fileMetadata,
                                    media: media,
                                },
                                function (err, file){
                                    if(err){
                                        console.log(err);
                                    }else{
                                        // console.log("sucess");
                                        fs.unlink(req.file.destination + '/' + req.file.filename, (err) => {
                                            if (err) {
                                                console.error(err)
                                                return
                                            }
                                        })

                                        item.submissions.push({
                                            subType: req.body.subType,
                                            name: req.user.username + "_" +item.name,
                                            studentid: req.user._id,
                                            googleid: file.data.id,
                                            extension: mime.extension(file.data.mimeType),
                                        })
                                        found.save(function (err) {
                                            if (!err) {
                                                res.redirect("/" + req.params.schoolname + "/" + req.params.courseid);
                                            }
                                            console.log(err);
                                        })
                                    }
                                })
                            }
                        }
                    }
                })
               
            }
        })
    }
})

// add course content

app.get('/:schoolname/:course_id/add_course_cont', function (req, res) {

    // authorize(req.params.schoolname,res,list_files);

    // function list_files(auth){
    //     const drive = google.drive({ version: "v3", auth });
    //     // console.log(auth);

    //     drive.files.list({}, (err, res) => {
    //         try {if (err) throw err;
    //         const files = res.data.files;
    //         if (files.length) {
    //             files.map((file) => {
    //                 console.log(file);
    //             });
    //         } else {
    //             console.log('No files found');
    //         }}
    //         catch (err) {
    //             console.log(err);
    //         }
    //     })

    // }

    res.render("add_course_cont", {
        school: req.params.schoolname,
        course_id: req.params.course_id
    });

})



app.post('/:schoolname/:course_id/add_course_cont', uploadDisk.single("file"), function (req, res) {
    // console.log(req.body);
    // console.log(req.file);
    if (req.isAuthenticated() && req.user.role == "professor") {
        Course.findOne({
            _id: req.params.course_id
        }, function (err, found) {
            if (err) {
                console.log(err);
            }
            if (found) {
                var fileMetadata = {
                    name: req.body.content_name, // file name that will be saved in google drive
                    parents: [found.drivefolderid]
                };
                var media = {
                    mimeType: req.file.mimetype,
                    body: fs.createReadStream(req.file.destination + '/' + req.file.filename), // Reading the file from our server
                };

                authorize(req.params.schoolname, res, create_file);

                function create_file(auth) {
                    const drive = google.drive({
                        version: "v3",
                        auth
                    });
                    drive.files.create({
                            resource: fileMetadata,
                            media: media,
                        },
                        function (err, file) {
                            if (err) {
                                // Handle error
                                console.error(err.msg);
                            } else {
                                // if file upload success then return the unique google drive id
                                console.log("sucess");
                                fs.unlink(req.file.destination + '/' + req.file.filename, (err) => {
                                    if (err) {
                                        console.error(err)
                                        return
                                    }
                                })
                                // console.log(file);
                                if(req.body.contentType == "content"){
                                    found.items.push({
                                        contentType: req.body.contentType,
                                        name: req.body.content_name,
                                        google_id: file.data.id,
                                        extension: mime.extension(file.data.mimeType)
                                    });
                                    
                                }

                                else{
                                    var fileMetadata = {
                                        'name': req.body.content_name,
                                        'mimeType': 'application/vnd.google-apps.folder',
                                        parents: [found.drivefolderid]
                                    };
                                    drive.files.create({
                                        resource: fileMetadata,
                                        fields: 'id'
                                    }, function(err,file){
                                        if(err){
                                            console.log(err);
                                        } else{
                                            found.items.push({
                                                contentType: req.body.contentType,
                                                name: req.body.content_name,
                                                google_id: file.data.id,
                                                extension: mime.extension(file.data.mimeType),
                                                deadline: req.body.deadline,
                                                drivefolderid: file.data.id,
                                            });
                                            found.save(function (err) {
                                                if (!err) {
                                                    res.redirect("/" + req.params.schoolname + "/" + req.params.course_id);
                                                }
                                                console.log(err);
                                            })
                                        }
                                    })
                                    
                                }
                                found.save(function (err) {
                                    if (!err) {
                                        res.redirect("/" + req.params.schoolname + "/" + req.params.course_id);
                                    }
                                    console.log(err);
                                })
                            }
                        }
                    );
                }

            } else {
                console.log("not found");
            }
        })
    }
})



// Download content file

app.post('/:schoolname/download/:filename/:fileid', function (req, res) {
    var fileId = req.params.fileid;
    var dest = fs.createWriteStream('./public/' + req.params.filename);

    authorize(req.params.schoolname, res, download_file);

    function download_file(auth) {
        const drive = google.drive({
            version: "v3",
            auth
        });
        drive.files
            .get({
                fileId,
                alt: 'media'
            }, {
                responseType: 'stream'
            })
            .then((driveResponse) => {
                driveResponse.data
                    .on('end', () => {
                        console.log('\nDone downloading file.');
                        const file = "./public/" + req.params.filename; // file path from where node.js will send file to the requested user
                        res.download(file, function (err) {
                            //CHECK FOR ERROR
                            // console.log("inside download")
                            fs.unlink('./public/' + req.params.filename, (err) => {
                                if (err) {
                                    console.error(err)
                                    return
                                }
                            })
                        }); // Set disposition and send it.
                        //   
                    })
                    .on('error', (err) => {
                        console.error('Error downloading file.');
                    })
                    .pipe(dest);
            })
    }
});

// delete course content

app.get('/:schoolname/:course_id/delete_course_cont', function (req, res) {

    Course.findOne({
        _id: req.params.course_id,
    }, function (err, found) {
        if (err) {
            console.log(err);
        }
        if (found) {
            res.render("delete_course_cont", {
                school: req.params.schoolname,
                course_id: req.params.course_id,
                found: found,
            });
        } else {
            res.render("error404");
        }
    })
});

app.post('/:schoolname/:course_id/delete_course_cont', function (req, res) {
    Course.findOne({
        _id: req.params.course_id
    }, function (err, found) {
        if (err) {
            console.log(err);
        }
        if (found) {
            // console.log(Array.isArray(req.body.delete));
            found.items.forEach(function (item, i) {
                if (item._id == req.body.delete) {

                    authorize(req.params.schoolname, res, delete_content);

                    function delete_content(auth) {
                        const drive = google.drive({
                            version: "v3",
                            auth
                        });
                        drive.files.delete({
                                fileId: item.google_id,
                            })
                            .then(
                                async function (response) {
                                        console.log("success");
                                    },
                                    function (err) {
                                        console.log(err);
                                    }
                            );
                    }

                    found.items.splice(i, 1);
                }
            })
        }
        found.save(function (err) {
            if (!err) {
                res.redirect("/" + req.params.schoolname + "/" + req.params.course_id);
            }
            console.log(err);
        })
    })

})









//calendar
app.get("/:schoolname/:courseid/create_course_event",function(req,res){
    if(req.isAuthenticated() && req.user.role == "professor" && req.user.schoolshort == req.params.schoolname){
        res.render("create_course_event",{school: req.params.schoolname, courseid: req.params.courseid})
    }else{
        res.redirect("/" + req.params.schoolname);
    }
});


app.get("/:schoolname/admin/eventpage", function(req,res){
    if(req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == req.params.schoolname){
        School.findOne({shortname: req.params.schoolname},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                res.render("admin_event_page",{school: found.shortname, events : found.events});
            }
        })  
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})


app.get("/:schoolname/professor/eventpage", function(req , res){
    if(req.isAuthenticated() && req.user.role == "professor" && req.user.schoolshort == req.params.schoolname){
        
        var allEvent = [];

        Course.find({'_id' : {$in: req.user.courses}}, function(err,found){
            if(err){
                console.log(err);
            }
            if(found){

                found.forEach(function(course){
                    allEvent = allEvent.concat(course.event);
                })

                allEvent = allEvent.map(JSON.stringify);
                var uniqueset = new Set(allEvent);
                allEvent = Array.from(uniqueset).map(JSON.parse);
                res.render("event_page",{school: req.params.schoolname, events : allEvent});
            }
        })
            
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})



app.get("/:schoolname/student/eventpage", function(req,res){
    if(req.isAuthenticated() && req.user.role == "student" && req.user.schoolshort == req.params.schoolname){
        
        var allEvent = [];

        Course.find({'_id' : {$in: req.user.courses}}, function(err,found){
            if(err){
                console.log(err);
            }
            if(found){

                found.forEach(function(course){
                    allEvent = allEvent.concat(course.event);
                })

                allEvent = allEvent.map(JSON.stringify);
                var uniqueset = new Set(allEvent);
                allEvent = Array.from(uniqueset).map(JSON.parse);
                res.render("event_page",{school: req.params.schoolname, events : allEvent});
            }
        })
            
    }else{
        res.redirect("/"+req.params.schoolname);
    }
})



app.get("/:schoolname/admin/create_event", function(req,res){
    if(req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == req.params.schoolname){
        School.findOne({ shortname: req.params.schoolname}, function(err, scl){
            if(err){
                console.log(err);
            }
            if(scl){
                Course.find({ '_id' : { $in : scl.courses}},function(err,found){
                    if(err){
                        console.log(err);
                    }
                    if(found){
                        res.render("create_event",{school: req.params.schoolname, courses: found});
                    }
                })
            }
        })   
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})


app.post("/:schoolname/create_event", function(req,res){
    if(req.isAuthenticated() && (req.user.role == "professor" || req.user.role == "admin") && req.user.schoolshort == req.params.schoolname){
        var courses = req.body.course;
        if(typeof(courses)=="string"){
            courses = [];
            courses.push(req.body.course);
        }
        Course.find({'_id': { $in : courses}}, function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                var event = {
                    'summary': req.body.summary,
                    'location': 'schudle',
                    'description': req.body.description,
                    'start': {
                      'dateTime': req.body.startdate + 'T' + req.body.starttime + ':00+05:30',
                      'timeZone': 'UTC+05:30',
                    },
                    'end': {
                      'dateTime': req.body.enddate + 'T' + req.body.endtime + ':00+05:30',
                      'timeZone': 'UTC+05:30',
                    },
                    'attendees': [],
                    'reminders': {
                      'useDefault': false,
                      'overrides': [
                        {'method': 'email', 'minutes': req.body.emailhours*60 + req.body.emailminutes},
                        {'method': 'popup', 'minutes': req.body.pophours*60 + req.body.popminutes},
                      ],
                    },
                };
                var evt = {
                    calendarId:'primary',
                    sendNotifications: true,
                    sendUpdates: 'all',
                    resource: event,
                }

                if(req.body.meet=="yes"){
                    event.conferenceData = {
                        'createRequest': {
                          'requestId': uniqid(),
                          'conferenceSolutionKey': {'type': "hangoutsMeet" },
                        },
                    };
                    evt.conferenceDataVersion= 1;
                    console.log(event);
                    console.log(evt);
                }

                found.forEach(function(course){
                    course.email.forEach(function(participant){
                        event.attendees.push({"email" : participant});
                    })
                });

                authorize(req.params.schoolname,res,create_event);


                function create_event(auth){
                   const calendar = google.calendar({version: 'v3', auth});
                   calendar.events.insert(evt, function(err, event) {
                    if (err) {
                        res.send(JSON.stringify(err));
                    }
                    if(event){
                        var localevt = {
                            summary: event.data.summary,
                            description: event.data.description,
                            start: event.data.start.dateTime,
                            googleid: event.data.id,
                            courses: courses,
                            general: req.body.general,
                            eventlink: event.data.htmlLink
                        }
                        if(event.data.hangoutLink){
                            localevt.meetlink = event.data.hangoutLink;
                        }
                        if(req.body.general=='false'){
                            Course.updateMany({'_id' : { $in : courses}}, {$push : { event : localevt}}, function(err, result) {
                                if (err) {
                                  console.log(err);
                                } else {
                                  console.log(result);
                                }
                              });
                              res.redirect("/"+ req.params.schoolname + "/professor/dashboard");
                        }else if(req.body.general=='true'){
                            Course.updateMany({'_id' : { $in : courses}}, {$push : { event : localevt}}, function(err, result) {
                                if (err) {
                                  console.log(err);
                                } else {
                                  console.log(result);
                                }
                              });
                            School.updateOne({shortname: req.params.schoolname}, {$push : {events : localevt}}, function(err,result){
                                if(err){
                                    console.log(err);
                                }
                                if(result){
                                    console.log(result);
                                }
                            });
                            res.redirect("/"+ req.params.schoolname + "/admin/dashboard");
                        } 
                        
                    }
                  });
                }
            }
        })
        
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})



app.get("/:schoolname/admin/delete_event", function(req,res){
    if(req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == req.params.schoolname){
        School.findOne({ shortname : req.params.schoolname},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                res.render("delete_event",{school: req.params.schoolname, events: found.events, courseid: ""});
            }
        })
        
    }else{
        res.redirect("/" + req.params.schoolname);
    } 
})



app.post("/:schoolname/admin/delete_event", function(req,res){
    if(req.isAuthenticated() && req.user.role == "admin" && req.user.schoolshort == req.params.schoolname){
        School.findOne({ shortname : req.params.schoolname},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                found.events.forEach(function(evt,i){
                    if(evt._id == req.body.event){
                        authorize(req.params.schoolname,res,delete_event);

                        function delete_event(auth){
                            const calendar = google.calendar({version: 'v3', auth});
                            calendar.events.delete({
                                calendarId: 'primary',
                                eventId : evt.googleid,
                              }, function(err, event) {
                                    if (err) {
                                      console.log(err);
                                    }
                              });
                        }
                        found.events.splice(i,1);
                        Courses.updateMany({'id' : {$in : evt.courses}}, {$pull : {event : evt._id}}, function(err,result){
                            if(err){
                                console.log(err);
                            }
                            if(result){
                                console.log(result);
                            }
                        })
                    }
                })
            }
            found.save(function(err){
                if(err){
                console.log(err);
                }
                res.redirect("/" + req.params.schoolname + "/admin/eventpage");
            })

        })
        
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})



app.get("/:schoolname/:courseid/delete_course_event", function(req,res){
    if(req.isAuthenticated() && req.user.role == "professor" && req.user.schoolshort == req.params.schoolname){
        Course.findOne({ '_id' : req.params.courseid},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                var courseEvent = found.event.filter(o => o.general=='false');
                res.render("delete_event",{school: req.params.schoolname,courseid: req.params.courseid, events: courseEvent});
            }
        })
        
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})


app.post("/:schoolname/:courseid/delete_course_event", function(req,res){
    if(req.isAuthenticated() && req.user.role == "professor" && req.user.schoolshort == req.params.schoolname){
        Course.findOne({ '_id' : req.params.courseid},function(err,found){
            if(err){
                console.log(err);
            }
            if(found){
                found.event.forEach(function(evt,i){
                    if(evt._id == req.body.event){
                        authorize(req.params.schoolname,res,delete_event);

                        function delete_event(auth){
                            const calendar = google.calendar({version: 'v3', auth});
                            calendar.events.delete({
                                calendarId: 'primary',
                                eventId : evt.googleid,
                              }, function(err, event) {
                                    if (err) {
                                      console.log(err);
                                    }
                              });
                        }
                        found.event.splice(i,1);
                    }
                })
            }
            found.save(function(err){
                if(err){
                console.log(err);
                }
                res.redirect("/" + req.params.schoolname + "/" + req.params.courseid);
            })

        })
        
    }else{
        res.redirect("/" + req.params.schoolname);
    }
})



app.get('/error404', function (req, res) {
    res.render('error404');
})
// Server Hosting
app.listen(3000, function () {
    console.log("server started");
})