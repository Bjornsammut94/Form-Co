# Form&Co website and back office

Two pages that share one database:

- `index.html` is the **customer website**: logo and hero, recent prints, catalogue, custom STL quote requests and order tracking.
- `admin.html` is **your back office**: new orders appear on the board within seconds. You also manage the catalogue and your price rates here.

Everything is plain HTML and JavaScript. There is nothing to install or build.

## How the pieces fit

| Part | What it is | Cost to start |
| --- | --- | --- |
| Website files | GitHub repository, shown with GitHub Pages | Free (the repository must be public) |
| Database, login, customer files | Supabase | Free plan (check their current limits) |

Customer STL files go into a **private** storage area that only you can open. Customers cannot read orders, files or other customers' details. They can only place an order and look up one order with its reference plus their contact.

## Setup

### 1. Create the database (Supabase)

1. Make a free account at supabase.com and click **New project**. Save the database password somewhere safe.
2. Open `supabase/schema.sql`, copy everything, and paste it into **SQL Editor > New query** in Supabase.
3. **In the Supabase editor** (not in the file), change `YOUR-EMAIL@example.com` near the bottom to the email you will sign in to the admin page with. Press **Run**. It should finish with "Success".
4. Optional: do the same with `supabase/seed-products.sql` to add the GT3 and Audi R8 models to your catalogue, hidden until you set prices.

Keep your email out of the files you upload to GitHub. The repository is public.

### 2. Create your admin login

In Supabase open **Authentication > Users > Add user > Create new user**. Use the same email as in step 1.3, pick a strong password and tick **Auto Confirm User**.

Then go to **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up" so nobody else can create accounts.

### 3. Connect the pages to the database

In Supabase open **Project Settings > API**.

- Copy the **Project URL** (it looks like `https://abcdxyz.supabase.co`) into `SUPABASE_URL` in `config.js`.
- Copy the **anon public** key into `SUPABASE_ANON_KEY`.

The anon key is designed to be public, so it is fine in a public repository. The rules in `schema.sql` are what protect your data. Never put the `service_role` key anywhere in these files.

While you are in `config.js`, adjust the tagline, intro text and the "Recent prints" list.

### 4. Put it on GitHub and turn on the website

1. Sign in at github.com and click **New repository**. Name it, for example, `formco`. Choose **Public**.
2. Unzip this folder on your computer. On the repository page choose **uploading an existing file** (or **Add file > Upload files**) and drag in **everything inside** the unzipped folder: `index.html`, `admin.html`, the `assets` and `supabase` folders and the rest. Do not upload the zip itself. Press **Commit changes**.
3. Open **Settings > Pages**. Under **Build and deployment** choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and press **Save**.
4. After a minute or two the page shows your address, for example `https://your-username.github.io/formco/`. Your back office is the same address followed by `admin.html`.
5. Open `index.html` on GitHub, press the pencil, and replace `https://YOUR-USERNAME.github.io/YOUR-REPO/assets/og-image.jpg` with your real address. This makes a nice picture appear when the link is shared on Facebook.

To change something later, edit the file on GitHub (pencil icon) or upload a new version, and the site updates within a minute or two.

### 5. Add your models

Sign in to the admin page and open the **Catalogue** tab. If you ran `seed-products.sql`, press **Edit** on the GT3 and Audi R8, set the price, colours, materials and description, and tick **Show on the website**. Add more with **Add a model**, and upload a photo for each.

Then set your real costs under **Rates**. The starting numbers are placeholders only.

## Pictures

- `assets/form-and-co-hero.jpg`: the logo photo on the home page.
- `assets/gallery/`: photos in the "Recent prints" section. To add one, upload the photo here and add a line in `config.js`.
- `assets/gallery/audi-r8-coming-soon.svg`: a drawn stand-in for the Audi R8. When you have a real photo, upload it to `assets/gallery/` and change the `image` path in `config.js`.
- `assets/products/`: starting pictures for the two seeded models. You can replace them by uploading a photo in the admin page.
- `assets/og-image.jpg`, `favicon.svg`, `apple-touch-icon.png`: the share picture and the small icons.

## How an order flows

1. A customer orders from the catalogue or uploads a file. It arrives in the **New request** column.
2. Catalogue orders already have a price. Press **Accept order**. Custom files need a price: open the job, download the file, enter weight and print time, press **Use** on the suggested price, then **Copy quote message** and send it to the customer.
3. Move the job along: Accepted, Printing, Ready to collect, Collected.
4. The customer can check progress on the website under **Track an order** with their reference and the email or phone they used.

## Things to know

- **Orders are not paid online.** Payment is arranged between you and the customer.
- **You are not emailed when an order arrives.** The admin tab title shows a count of new requests and a message appears while the page is open.
- **Spam protection** is basic: a hidden field plus a limit of 5 orders per contact per hour.
- **Customer files** can be up to 50 MB each. Deleting a job also deletes its files.
- **Free Supabase projects can pause** after a period of no activity. Check their current terms and open the admin page regularly.
- The admin page is public on the internet but only works after you sign in with your admin account.
- Export your jobs to CSV from the admin page now and then as a backup.

## Files

- `index.html`, `store.js`: customer website
- `admin.html`, `admin.js`: back office
- `shared.css`: shared look
- `config.js`: your settings and the "Recent prints" list
- `assets/`: pictures and icons
- `supabase/schema.sql`, `supabase/seed-products.sql`: database setup
