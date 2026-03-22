export interface Service {
  id: string;
  name: string;
  duration: number; // minutes
  price: number;
}

export interface Provider {
  id: string;
  name: string;
  category: string;
  rating: number;
  reviewCount: number;
  distance: string;
  image: string;
  coverImage: string;
  address: string;
  about: string;
  services: Service[];
  photos: string[];
  workingHours: { day: string; hours: string }[];
  reviews: { name: string; rating: number; comment: string; date: string }[];
}

export const categories = [
  { id: "barber", name: "Barber", icon: "✂️" },
  { id: "salon", name: "Hair Salon", icon: "💇" },
  { id: "nails", name: "Nails", icon: "💅" },
  { id: "brows", name: "Brows & Lashes", icon: "👁️" },
  { id: "spa", name: "Spa & Massage", icon: "🧖" },
  { id: "skincare", name: "Skincare", icon: "✨" },
];

export const providers: Provider[] = [
  {
    id: "1",
    name: "The Gentleman's Cut",
    category: "barber",
    rating: 4.9,
    reviewCount: 234,
    distance: "0.8 km",
    image: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1585747860019-8e8e14e0ef66?w=800&h=400&fit=crop",
    address: "12 Elm Street, Downtown",
    about: "Premium grooming experience with skilled barbers who understand modern and classic styles. Walk-ins welcome but appointments recommended.",
    services: [
      { id: "s1", name: "Classic Haircut", duration: 30, price: 35 },
      { id: "s2", name: "Beard Trim", duration: 20, price: 20 },
      { id: "s3", name: "Hot Towel Shave", duration: 40, price: 45 },
      { id: "s4", name: "Haircut + Beard", duration: 45, price: 50 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1503951914875-452d3928e1b0?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: "Mon–Fri", hours: "9:00 AM – 8:00 PM" },
      { day: "Saturday", hours: "9:00 AM – 6:00 PM" },
      { day: "Sunday", hours: "Closed" },
    ],
    reviews: [
      { name: "Ahmad K.", rating: 5, comment: "Best barber in town. Always leaves looking sharp.", date: "2 days ago" },
      { name: "Sara M.", rating: 5, comment: "Took my son here, they were so patient. Great cut!", date: "1 week ago" },
      { name: "Omar R.", rating: 4, comment: "Very professional. Slightly long wait on weekends.", date: "2 weeks ago" },
    ],
  },
  {
    id: "2",
    name: "Bloom Beauty Studio",
    category: "salon",
    rating: 4.8,
    reviewCount: 189,
    distance: "1.2 km",
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&h=400&fit=crop",
    address: "45 Rose Avenue, Midtown",
    about: "A full-service beauty studio offering haircuts, coloring, styling, and treatments in a relaxing atmosphere.",
    services: [
      { id: "s5", name: "Women's Haircut", duration: 45, price: 55 },
      { id: "s6", name: "Blowout & Style", duration: 30, price: 40 },
      { id: "s7", name: "Full Color", duration: 90, price: 120 },
      { id: "s8", name: "Highlights", duration: 120, price: 150 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: "Mon–Fri", hours: "10:00 AM – 7:00 PM" },
      { day: "Saturday", hours: "10:00 AM – 5:00 PM" },
      { day: "Sunday", hours: "Closed" },
    ],
    reviews: [
      { name: "Layla H.", rating: 5, comment: "My go-to salon! Amazing color work.", date: "3 days ago" },
      { name: "Noor A.", rating: 5, comment: "Beautiful studio and lovely staff.", date: "1 week ago" },
    ],
  },
  {
    id: "3",
    name: "Polished Nails & Co",
    category: "nails",
    rating: 4.7,
    reviewCount: 156,
    distance: "0.5 km",
    image: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=800&h=400&fit=crop",
    address: "8 Cedar Lane, West Side",
    about: "Nail art specialists offering gel, acrylic, and classic manicure/pedicure services with premium products.",
    services: [
      { id: "s9", name: "Classic Manicure", duration: 30, price: 25 },
      { id: "s10", name: "Gel Manicure", duration: 45, price: 40 },
      { id: "s11", name: "Classic Pedicure", duration: 40, price: 35 },
      { id: "s12", name: "Full Set Acrylic", duration: 60, price: 65 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1610992015732-2449b0680389?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: "Mon–Sat", hours: "9:00 AM – 7:00 PM" },
      { day: "Sunday", hours: "11:00 AM – 5:00 PM" },
    ],
    reviews: [
      { name: "Dina F.", rating: 5, comment: "Incredible nail art! They really care about detail.", date: "5 days ago" },
    ],
  },
  {
    id: "4",
    name: "Arch & Glow",
    category: "brows",
    rating: 4.9,
    reviewCount: 312,
    distance: "1.8 km",
    image: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d946?w=800&h=400&fit=crop",
    address: "22 Park Boulevard",
    about: "Brow and lash specialists. Microblading, lamination, lash extensions and more by certified artists.",
    services: [
      { id: "s13", name: "Brow Threading", duration: 15, price: 18 },
      { id: "s14", name: "Brow Lamination", duration: 45, price: 55 },
      { id: "s15", name: "Lash Extensions (Full)", duration: 90, price: 95 },
      { id: "s16", name: "Lash Lift & Tint", duration: 60, price: 70 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: "Tue–Sat", hours: "10:00 AM – 7:00 PM" },
      { day: "Sun–Mon", hours: "Closed" },
    ],
    reviews: [
      { name: "Reem S.", rating: 5, comment: "Best brows in the city. Period.", date: "1 day ago" },
      { name: "Hana T.", rating: 5, comment: "My lash extensions lasted 4 weeks! Amazing.", date: "1 week ago" },
    ],
  },
  {
    id: "5",
    name: "Serenity Spa",
    category: "spa",
    rating: 4.8,
    reviewCount: 98,
    distance: "2.3 km",
    image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
    coverImage: "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=800&h=400&fit=crop",
    address: "100 Wellness Drive",
    about: "A tranquil escape offering therapeutic massages, facials, and body treatments with organic products.",
    services: [
      { id: "s17", name: "Swedish Massage (60 min)", duration: 60, price: 85 },
      { id: "s18", name: "Deep Tissue Massage", duration: 60, price: 95 },
      { id: "s19", name: "Signature Facial", duration: 50, price: 75 },
      { id: "s20", name: "Hot Stone Therapy", duration: 75, price: 110 },
    ],
    photos: [
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=400&fit=crop",
      "https://images.unsplash.com/photo-1540555700478-4be289fbec6d?w=400&h=400&fit=crop",
    ],
    workingHours: [
      { day: "Mon–Sun", hours: "9:00 AM – 9:00 PM" },
    ],
    reviews: [
      { name: "Yasmin B.", rating: 5, comment: "Heaven on earth. Will be back every month.", date: "3 days ago" },
    ],
  },
];

export const timeSlots = [
  "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
  "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM",
  "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
  "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM",
];

export const getAvailableSlots = (_providerId: string, _date: Date): string[] => {
  // Mock: randomly remove some slots to simulate availability
  const seed = _date.getDate();
  return timeSlots.filter((_, i) => (i + seed) % 3 !== 0);
};
