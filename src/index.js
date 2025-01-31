const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const readline = require("readline");

const RESULT_FOLDER = path.join(__dirname, "../");
const TOKEN_FILE = path.join(__dirname, "token.json");
const INVOICE_FOLDER = path.join(__dirname, "all");
const EXPECTED_FILE = path.join(__dirname, "expected.json");
const RESULT_FILE_PREFIX = "result";

const API_URL = "https://api-sandbox.oxpay.com.br/info/receipt";

async function sendInvoicesInRange(startIndex, endIndex) {
	try {
		if (!fs.existsSync(TOKEN_FILE))
			throw new Error("Arquivo token.json não encontrado.");
		const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));

		if (!tokenData || !tokenData.token)
			throw new Error(
				"Token inválido ou não encontrado no arquivo token.json."
			);

		if (!fs.existsSync(EXPECTED_FILE))
			throw new Error("Arquivo expected.json não encontrado.");
		const expectedData = JSON.parse(fs.readFileSync(EXPECTED_FILE, "utf8"));

		if (!fs.existsSync(INVOICE_FOLDER))
			throw new Error("Pasta de notas fiscais (eco) não encontrada.");

		const invoiceFiles = fs
			.readdirSync(INVOICE_FOLDER)
			.filter((file) => file.endsWith(".jpg"));

		if (invoiceFiles.length !== expectedData.length) {
			throw new Error(
				`Número de notas fiscais (${invoiceFiles.length}) não corresponde ao número esperado (${expectedData.length}) no arquivo expected.json.`
			);
		}

		if (
			startIndex < 0 ||
			endIndex >= invoiceFiles.length ||
			startIndex > endIndex
		) {
			console.error(
				"Intervalo inválido. Certifique-se de que os índices estejam corretos."
			);
			return;
		}

		let results = [];
		for (let i = startIndex; i <= endIndex; i++) {
			const invoiceFile =
				path.join(INVOICE_FOLDER, `invoice-${i}.jpg`) ||
				path.join(INVOICE_FOLDER, `invoice-${i}.jpeg`);
			if (!fs.existsSync(invoiceFile)) {
				results.push({
					file: `invoice-${i}.jpg`,
					status: "Erro",
					message: "Arquivo da nota fiscal não encontrado.",
				});
				continue;
			}

			const formData = new FormData();
			formData.append("file", fs.createReadStream(invoiceFile));

			const config = {
				headers: {
					...formData.getHeaders(),
					Authorization: `Bearer ${tokenData.token}`,
				},
			};

			try {
				const response = await axios.post(API_URL, formData, config);
				const responseData = response.data;

				const expectedInvoice = expectedData[i];
				const differences = [];

				for (const key in expectedInvoice) {
					if (expectedInvoice[key] !== responseData[key]) {
						differences.push(
							`Campo: ${key}, Esperado: ${expectedInvoice[key]}, Recebido: ${responseData[key]}`
						);
					}
				}

				results.push({
					file: `invoice-${i}.jpg`,
					status: differences.length === 0 ? "Sucesso" : "Falha",
					message:
						differences.length === 0
							? "A resposta da API corresponde ao esperado."
							: "Diferenças encontradas.",
					differences,
					responseData,
					expectedData: expectedInvoice,
				});
			} catch (error) {
				if (error.response && error.response.status === 401) {
					throw new Error(
						"Erro 401: Token de autenticação inválido ou expirado. Atualize o token e tente novamente."
					);
				}

				results.push({
					file: `invoice-${i}.jpg`,
					status: "Erro",
					message: error.message,
				});
			}
		}

		console.log("===== RESULTADO FINAL =====");
		console.log(`Total de notas testadas: ${results.length}`);
		results.forEach((result) => {
			console.log(`Nota: ${result.file} | Status: ${result.status}`);
			if (result.status !== "Sucesso") {
				console.log(`Motivo: ${result.message}`);
				if (result.differences && result.differences.length > 0) {
					console.log("Diferenças:", result.differences.join("; "));
				}
			}
		});

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const resultFileName = `${RESULT_FILE_PREFIX}_${results.length}_notas_${timestamp}.json`;
		fs.writeFileSync(resultFileName, JSON.stringify(results, null, 2));
		console.log(`Relatório salvo em: ${resultFileName}`);
		showMenu();
	} catch (error) {
		console.error("Erro:", error.message);
	}
}

async function evaluateJsonResults() {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	function askQuestion(query) {
		return new Promise((resolve) => rl.question(query, resolve));
	}

	function listResultFiles() {
		return fs
			.readdirSync(RESULT_FOLDER)
			.filter((file) => file.startsWith("result_") && file.endsWith(".json"));
	}

	async function selectFile() {
		const files = listResultFiles();

		if (files.length === 0) {
			console.log("Nenhum arquivo de resultado encontrado.");
			return null;
		}

		console.log("\n===== Arquivos Disponíveis =====");
		files.forEach((file, index) => console.log(`${index + 1} - ${file}`));

		const choice = await askQuestion("Escolha o número do arquivo: ");
		const fileIndex = parseInt(choice) - 1;

		if (fileIndex < 0 || fileIndex >= files.length) {
			console.log("Opção inválida.");
			return null;
		}

		return files[fileIndex];
	}

	async function evaluateFile(filePath) {
		const fileContent = fs.readFileSync(filePath, "utf8");
		const data = JSON.parse(fileContent);

		const totalTests = data.length;
		const successfulTests = data.filter((item) => item.status === "Sucesso");
		const failedTests = data.filter(
			(item) => item.status === "Falha" && item.message
		);
		const errorTests = data.filter(
			(item) => item.status !== "Sucesso" && item.status !== "Falha"
		);

		console.log("\n===== Resultados do Teste =====");
		console.log(`Total de Testes: ${totalTests}`);
		console.log(`Sucessos: ${successfulTests.length}`);
		console.log(`Falhas: ${failedTests.length}`);
		console.log(`Erros: ${errorTests.length}\n`);

		return { successfulTests, failedTests, errorTests };
	}

	function exportResults(results, filename) {
		const exportFilePath = path.join(RESULT_FOLDER, filename);
		fs.writeFileSync(exportFilePath, JSON.stringify(results, null, 2));
		console.log(`\nResultados exportados com sucesso em: ${exportFilePath}`);
		showMenu();
	}

	async function menu() {
		while (true) {
			const selectedFile = await selectFile();

			if (!selectedFile) break;

			const filePath = path.join(RESULT_FOLDER, selectedFile);
			const { successfulTests, failedTests, errorTests } = await evaluateFile(
				filePath
			);

			while (true) {
				console.log("\n===== Menu de Opções =====");
				console.log("1 - Reavaliar outro arquivo");
				console.log("2 - Exportar resultados de sucesso");
				console.log("3 - Exportar falhas");
				console.log("4 - Exportar erros");
				console.log("5 - Exportar falhas e erros juntos");
				console.log("6 - Voltar ao menu principal");
				console.log("0 - Sair");

				const option = await askQuestion("Escolha uma opção: ");

				switch (option) {
					case "1":
						break;
					case "2":
						exportResults(
							successfulTests,
							`success_${selectedFile.replace("result_", "")}`
						);
						break;
					case "3":
						exportResults(
							failedTests,
							`failures_${selectedFile.replace("result_", "")}`
						);
						break;
					case "4":
						exportResults(
							errorTests,
							`errors_${selectedFile.replace("result_", "")}`
						);
						break;
					case "5":
						exportResults(
							[...failedTests, ...errorTests],
							`failures_errors_${selectedFile.replace("result_", "")}`
						);
						break;
					case "6":
						showMenu();
						return;
					case "0":
						rl.close();
						return;
					default:
						console.log("Opção inválida.");
				}
				if (option === "1") break;
			}
		}
	}

	await menu();
}

function showMenu() {
	if (!fs.existsSync(EXPECTED_FILE) || !fs.existsSync(INVOICE_FOLDER)) {
		console.error("Arquivos necessários não encontrados.");
		return;
	}

	const expectedData = JSON.parse(fs.readFileSync(EXPECTED_FILE, "utf8"));
	const invoiceFiles = fs
		.readdirSync(INVOICE_FOLDER)
		.filter((file) => file.endsWith(".jpg"));

	console.log("===== MENU PRINCIPAL =====");
	console.log(`Total de registros no expected.json: ${expectedData.length}`);
	console.log(`Total de imagens na pasta: ${invoiceFiles.length}`);
	console.log("Escolha uma opção:");
	console.log("1 - Testar todas as Notas");
	console.log("2 - Testar intervalo de Notas");
	console.log("3 - Analisar resultados");
	console.log("0 - Sair");

	const readline = require("readline").createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	readline.question("Digite a opção desejada: ", (option) => {
		switch (option) {
			case "1":
				sendInvoicesInRange(0, invoiceFiles.length - 1);
				break;
			case "2":
				readline.question("Informe o índice inicial: ", (start) => {
					readline.question("Informe o índice final: ", (end) => {
						sendInvoicesInRange(parseInt(start), parseInt(end));
						readline.close();
					});
				});
				break;
			case "3":
				evaluateJsonResults();
				break;
			case "0":
				console.log("Saindo...");
				readline.close();
				break;
			default:
				console.log("Opção inválida.");
				readline.close();
				break;
		}
	});
}

showMenu();
