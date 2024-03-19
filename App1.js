const express = require('express');
const http = require('http');
const dgram = require('dgram');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const moment = require('moment');
const dotenv = require('dotenv'); 
dotenv.config();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const port = process.env.PORT ;
const udpPort = process.env.UDP_PORT ;

const udpServer = dgram.createSocket('udp4');

// MySQL connection configuration
const dbConnection = mysql.createConnection({
  host: process.env.DB_HOST ,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

dbConnection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err.message);
    return;
  }
  console.log('Connected to MySQL database');
});

// Function to get the latest data from MySQL
async function getLatestData() {
  return new Promise((resolve, reject) => {
    dbConnection.query('SELECT fecha, latitud, longitud, altitud FROM coordenadas ORDER BY fecha DESC LIMIT 1', (error, results) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(results[0]);
    });
  });
}

// Handle the upgrade event for WebSocket
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, async (ws) => {
    // Send the latest data to the new WebSocket client
    const latestData = await getLatestData();
    if (latestData) {
      ws.send(JSON.stringify(latestData));
    }

    wss.emit('connection', ws, request);
  });
});

udpServer.on('message', async (msg, rinfo) => {
  const messageString = msg.toString();

  const match = messageString.match(/FH: (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}) Lat: (\d+\.\d+) Lon: (-?\d+\.\d+) Alt: (-?\d+\.\d+)/);

  if (match) {
    const fechaString = match[1];
    const fecha = moment(fechaString, 'DD/MM/YYYY HH:mm:ss').format('YYYY-MM-DD HH:mm:ss');
    const latitud = parseFloat(match[2]);
    const longitud = parseFloat(match[3]);
    const altitud = parseFloat(match[4]);

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ latitud, longitud, fecha, altitud }));
      }
    });

    console.log('Datos enviados a clientes WebSocket:', { latitud, longitud, fecha, altitud });

    dbConnection.query('INSERT IGNORE INTO coordenadas(fecha, latitud, longitud, altitud) VALUES(?, ?, ?, ?)', [fecha, latitud, longitud, altitud], (error, results) => {
      if (error) {
        console.error('Error al guardar datos en MySQL:', error.message);
        return;
      }
      if (results.affectedRows === 0) {
        console.log('Datos duplicados, no se insertaron en MySQL:', { fecha, latitud, longitud, altitud });
      } else {
        console.log('Datos guardados en MySQL:', { fecha, latitud, longitud, altitud });
      }
    });
  } else {
    console.error('Mensaje UDP no tiene el formato esperado:', msg.toString());
  }
});

udpServer.bind(udpPort, () => {
  console.log(`Servidor UDP escuchando en el puerto ${udpPort}`);
});

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index1.html');
});

app.get('/filtrar', (req, res) => {
  const fechaInicio = req.query.inicio;
  const fechaFin = req.query.fin;

  dbConnection.query('SELECT * FROM coordenadas WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC', [fechaInicio, fechaFin], (error, results) => {
    if (error) {
      console.error('Error al filtrar datos:', error);
      res.status(500).json({ error: 'Error al filtrar datos' });
      return;
    }
    res.json(results);
  });
});

server.listen(port);
