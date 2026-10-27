FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# 7860 is the standard port for Hugging Face Spaces, also works with PORT env var
ENV PORT=7860
EXPOSE 7860
EXPOSE 3000

CMD ["npm", "start"]
