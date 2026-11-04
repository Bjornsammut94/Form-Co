// Fill in the two Supabase values (Project Settings > API in the Supabase dashboard).
//   SUPABASE_URL      = the "Project URL", for example https://abcdxyz.supabase.co
//   SUPABASE_ANON_KEY = the "anon public" key
// The anon key is meant to be public. The database rules in supabase/schema.sql protect your data.
window.FC_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // Shown on the customer website.
  BRAND: {
    name: 'Form&Co',
    tagline: 'Custom 3D printing',
    intro: 'Pick a design from our catalogue, or send us your own file and we will quote you.',
    // Optional line shown in the footer, e.g. 'Message us on Facebook: Form&Co'
    contactLine: ''
  },

  // The "Recent prints" photos on the home page. Add a photo to the assets/gallery folder,
  // then add a line here. Remove the whole list to hide the section.
  GALLERY: [
    {image: 'assets/gallery/gt3-key-holder.jpg', width: 900, height: 1200,
     title: 'GT3 wall key holder', text: 'Printed in several colours, with four hooks for your keys.'},
    {image: 'assets/gallery/audi-r8-coming-soon.svg', width: 800, height: 600,
     title: 'Audi R8', text: 'Printed and ready. Photos coming soon.'}
  ],

  // Materials customers can choose from for custom prints.
  CUSTOM_MATERIALS: ['PLA', 'PETG', 'ABS', 'TPU', 'Not sure'],

  MAX_STL_MB: 50
};
