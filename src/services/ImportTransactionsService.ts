import { getCustomRepository, getRepository, In } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';

import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface CSVTransactions {
  title: string;
  value: number;
  type: 'income' | 'outcome';
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionRepository = getCustomRepository(TransactionsRepository);
    const categoryRepository = getRepository(Category);

    // Inicio da importação do CSV
    const contactsReadStream = fs.createReadStream(filePath);

    // Ignora a primeira linha
    const parsers = csvParse({
      from_line: 2,
    });

    const parseCSV = contactsReadStream.pipe(parsers);

    const transactions: CSVTransactions[] = [];
    const categories: string[] = [];

    // Leitura do arquivo
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, value, type, category });
    });

    // Espera a flag de fim de leitura do CSV
    await new Promise(resolve => parseCSV.on('end', resolve));

    // Verifica se existe as categorias no BD com o metodo In
    const existentCategory = await categoryRepository.find({
      where: {
        title: In(categories),
      },
    });

    // Verifica todas as categorias existentes
    const existentCategoryTitles = existentCategory.map(
      (category: Category) => category.title,
    );

    // Filtra as categorias inexistentes no BD
    const addCategoryTitles = categories
      .filter(category => !existentCategoryTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    // Cria as categorias inexistentes
    const newCategories = categoryRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    // Salva as categorias inexitentes no BD
    await categoryRepository.save(newCategories);

    // Todas as categorias existentes
    const allCategories = [...existentCategory, ...newCategories];

    const createdTransactions = await transactionRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        value: transaction.value,
        type: transaction.type,
        category: allCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
